export const maxDuration = 60

import { NextResponse } from 'next/server'
import { query as dbQuery } from '@/lib/db'
import { getItems, getChainMap } from '@/lib/services/analytics-service'
import { getCached, setCache } from '@/lib/redis-client'
import { CACHE_TTL } from '@/lib/constants'
import { fixRtlItemName } from '@/lib/rtl-fix'

type UrgencyLevel = 'critical' | 'warning' | 'watch' | 'ok'

function getUrgency(days: number | null): UrgencyLevel {
  if (days === null) return 'ok' // infinite stock (no demand)
  if (days < 30) return 'critical'
  if (days < 60) return 'warning'
  if (days < 90) return 'watch'
  return 'ok'
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const urgencyFilter = searchParams.get('urgency') || ''

    const cacheKey = `stock-forecast:list:v2:${limit}:${urgencyFilter}`
    const cached = await getCached<any>(cacheKey)
    if (cached) return NextResponse.json(cached)

    // Get live item data (stock, price, sold_this_year, sold_last_year, etc.)
    // getItems() already returns chain-merged items (old codes aggregated into canonical)
    const [allItems, chainMap] = await Promise.all([getItems(), getChainMap()])

    // Get monthly sales history from PG (if available)
    // Map old item codes → canonical code so chain data aggregates properly
    const monthlyDemand = new Map<string, { totalQty: number; months: number }>()
    try {
      const pgResult = await dbQuery(
        `SELECT item_code, SUM(quantity) as total_qty, COUNT(DISTINCT (year * 100 + month)) as month_count
         FROM dashboard.monthly_sales
         WHERE quantity > 0
         GROUP BY item_code`
      )
      for (const row of pgResult.rows) {
        const canonical = chainMap.get(row.item_code) || row.item_code
        const existing = monthlyDemand.get(canonical)
        if (existing) {
          existing.totalQty += parseFloat(row.total_qty) || 0
          existing.months = Math.max(existing.months, parseInt(row.month_count, 10) || 1)
        } else {
          monthlyDemand.set(canonical, {
            totalQty: parseFloat(row.total_qty) || 0,
            months: parseInt(row.month_count, 10) || 1,
          })
        }
      }
    } catch (e) {
      // monthly_sales may be empty — fall back to sold_this_year/sold_last_year below
    }

    const now = new Date()
    const currentMonth = now.getMonth() + 1 // 1-12

    const items = allItems
      .filter(item => (item.stock_qty || 0) > 0 || (item.sold_this_year || 0) > 0)
      .map(item => {
        const stock = item.stock_qty || 0
        const price = item.price || 0
        // Inbound supply that's already committed: on order from supplier + in transit.
        const incomingQty = item.incoming_qty || 0
        const orderedQty = item.ordered_qty || 0
        const pipelineQty = incomingQty + orderedQty

        // Calculate avg monthly demand from monthly_sales if available,
        // otherwise estimate from sold_this_year / sold_last_year
        let avgMonthlyDemand: number
        let confidence: number

        const pgData = monthlyDemand.get(item.code)
        if (pgData && pgData.months >= 3) {
          avgMonthlyDemand = pgData.totalQty / pgData.months
          confidence = Math.min(0.95, 0.5 + pgData.months * 0.04) // more months = higher confidence
        } else {
          // Fallback: use annualized sold data
          const soldThisYear = item.sold_this_year || 0
          const soldLastYear = item.sold_last_year || 0

          if (soldThisYear > 0 && currentMonth >= 2) {
            // Annualize current year sales
            avgMonthlyDemand = soldThisYear / currentMonth
            confidence = Math.min(0.7, 0.3 + currentMonth * 0.03)
          } else if (soldLastYear > 0) {
            avgMonthlyDemand = soldLastYear / 12
            confidence = 0.4
          } else {
            avgMonthlyDemand = 0
            confidence = 0.1
          }

          // Blend with PG data if partial
          if (pgData && pgData.months >= 1) {
            const pgAvg = pgData.totalQty / pgData.months
            avgMonthlyDemand = (avgMonthlyDemand + pgAvg) / 2
            confidence = Math.min(confidence + 0.1, 0.85)
          }
        }

        // Calculate days until stockout
        let daysUntilStockout: number | null = null
        let stockOutDate: string | null = null

        if (avgMonthlyDemand > 0 && stock > 0) {
          const monthsRemaining = stock / avgMonthlyDemand
          daysUntilStockout = Math.round(monthsRemaining * 30.44) // avg days per month
          const outDate = new Date(now.getTime() + daysUntilStockout * 86400000)
          stockOutDate = outDate.toISOString().split('T')[0]
        } else if (avgMonthlyDemand <= 0) {
          daysUntilStockout = null // no demand = no stockout
          stockOutDate = null
        } else {
          daysUntilStockout = 0 // already out of stock
          stockOutDate = now.toISOString().split('T')[0]
        }

        // Coverage including inbound pipeline — an item with plenty already ordered /
        // on the way shouldn't scream critical. No ETA data exists, so this assumes
        // the pipeline lands before the shelves empty; both day-counts are returned
        // so the operator can judge.
        let daysWithPipeline: number | null = daysUntilStockout
        if (avgMonthlyDemand > 0 && pipelineQty > 0) {
          daysWithPipeline = Math.round(((stock + pipelineQty) / avgMonthlyDemand) * 30.44)
        }

        const stockUrgency = getUrgency(daysUntilStockout)
        const urgency = getUrgency(daysWithPipeline)

        return {
          item_code: item.code,
          item_name: fixRtlItemName(item.name),
          current_stock: stock,
          incoming_qty: incomingQty,
          ordered_qty: orderedQty,
          pipeline_qty: pipelineQty,
          price,
          predicted_monthly_demand: Math.round(avgMonthlyDemand * 10) / 10,
          stock_out_date: stockOutDate,
          days_until_stockout: daysUntilStockout,
          days_with_pipeline: daysWithPipeline,
          confidence: Math.round(confidence * 100) / 100,
          urgency,
          stock_urgency: stockUrgency,
        }
      })
      // Filter by urgency if requested
      .filter(item => {
        if (!urgencyFilter) return item.urgency !== 'ok' || item.predicted_monthly_demand > 0
        const filters = urgencyFilter.split(',')
        return filters.includes(item.urgency)
      })
      // Sort: critical first, then by days_until_stockout ascending
      .sort((a, b) => {
        const urgencyOrder: Record<string, number> = { critical: 0, warning: 1, watch: 2, ok: 3 }
        const diff = (urgencyOrder[a.urgency] || 3) - (urgencyOrder[b.urgency] || 3)
        if (diff !== 0) return diff
        return (a.days_with_pipeline ?? 9999) - (b.days_with_pipeline ?? 9999)
      })
      .slice(0, limit)

    const result = { items }
    await setCache(cacheKey, result, CACHE_TTL.ANALYTICS)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[stock-forecast] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch stock forecast' },
      { status: 500 }
    )
  }
}
