export const maxDuration = 60

import { NextResponse } from 'next/server'
import { query as dbQuery } from '@/lib/db'
import { getItems } from '@/lib/services/analytics-service'
import { getCached, setCache } from '@/lib/redis-client'
import { CACHE_TTL } from '@/lib/constants'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ item_code: string }> }
) {
  try {
    const { item_code } = await params

    const cacheKey = `stock-forecast:item:v2:${item_code}`
    const cached = await getCached<any>(cacheKey)
    if (cached) return NextResponse.json(cached)

    // Get live item data
    const allItems = await getItems()
    const item = allItems.find(i => i.code === item_code)
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    const stock = item.stock_qty || 0
    const now = new Date()
    const currentMonth = now.getMonth() + 1

    // Get monthly sales history for this item (and alias codes)
    const codes = [item_code, ...(item.alias_codes || [])]
    const placeholders = codes.map((_, i) => `$${i + 1}`).join(', ')
    let historicalMonthly: { year: number; month: number; quantity: number }[] = []

    try {
      const pgResult = await dbQuery(
        `SELECT year, month, SUM(quantity) as qty
         FROM dashboard.monthly_sales
         WHERE item_code IN (${placeholders}) AND quantity > 0
         GROUP BY year, month
         ORDER BY year, month`,
        codes
      )
      historicalMonthly = pgResult.rows.map((r: any) => ({
        year: r.year,
        month: r.month,
        quantity: parseFloat(r.qty) || 0,
      }))
    } catch (e) {
      // monthly_sales may be empty
    }

    // Calculate demand using Holt's exponential smoothing if enough data,
    // otherwise simple average
    let avgMonthlyDemand: number
    let confidence: number

    if (historicalMonthly.length >= 3) {
      // Simple exponential smoothing (alpha = 0.3 for level, beta = 0.1 for trend)
      const quantities = historicalMonthly.map(h => h.quantity)
      const alpha = 0.3
      const beta = 0.1

      let level = quantities[0]
      let trend = quantities.length > 1 ? quantities[1] - quantities[0] : 0

      for (let i = 1; i < quantities.length; i++) {
        const prevLevel = level
        level = alpha * quantities[i] + (1 - alpha) * (level + trend)
        trend = beta * (level - prevLevel) + (1 - beta) * trend
      }

      avgMonthlyDemand = Math.max(0, level + trend)
      confidence = Math.min(0.95, 0.5 + historicalMonthly.length * 0.04)
    } else {
      // Fallback to annualized data
      const soldThisYear = item.sold_this_year || 0
      const soldLastYear = item.sold_last_year || 0

      if (soldThisYear > 0 && currentMonth >= 2) {
        avgMonthlyDemand = soldThisYear / currentMonth
        confidence = Math.min(0.7, 0.3 + currentMonth * 0.03)
      } else if (soldLastYear > 0) {
        avgMonthlyDemand = soldLastYear / 12
        confidence = 0.4
      } else {
        avgMonthlyDemand = 0
        confidence = 0.1
      }
    }

    // Calculate stock-out date
    let daysUntilStockout: number | null = null
    let stockOutDate: string | null = null

    if (avgMonthlyDemand > 0 && stock > 0) {
      const monthsRemaining = stock / avgMonthlyDemand
      daysUntilStockout = Math.round(monthsRemaining * 30.44)
      const outDate = new Date(now.getTime() + daysUntilStockout * 86400000)
      stockOutDate = outDate.toISOString().split('T')[0]
    } else if (avgMonthlyDemand <= 0) {
      daysUntilStockout = null
      stockOutDate = null
    } else {
      daysUntilStockout = 0
      stockOutDate = now.toISOString().split('T')[0]
    }

    // Build 6-month projections
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const monthlyProjections = []
    let projectedStock = stock

    for (let i = 1; i <= 6; i++) {
      const futureDate = new Date(now.getFullYear(), now.getMonth() + i, 1)
      const monthLabel = `${monthNames[futureDate.getMonth()]} ${futureDate.getFullYear()}`
      projectedStock = Math.max(0, projectedStock - avgMonthlyDemand)
      monthlyProjections.push({
        month: monthLabel,
        projected_stock: Math.round(projectedStock),
        predicted_demand: Math.round(avgMonthlyDemand * 10) / 10,
      })
    }

    const result = {
      item_code: item.code,
      item_name: item.name,
      current_stock: stock,
      incoming_qty: item.incoming_qty || 0,
      ordered_qty: item.ordered_qty || 0,
      predicted_monthly_demand: Math.round(avgMonthlyDemand * 10) / 10,
      stock_out_date: stockOutDate,
      days_until_stockout: daysUntilStockout,
      confidence: Math.round(confidence * 100) / 100,
      monthly_projections: monthlyProjections,
      historical_monthly: historicalMonthly.map(h => ({
        month: h.month,
        quantity: h.quantity,
        label: `${h.year}-${String(h.month).padStart(2, '0')}`,
      })),
    }

    await setCache(cacheKey, result, CACHE_TTL.ANALYTICS)
    return NextResponse.json(result)
  } catch (error) {
    console.error('[stock-forecast-item] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch item forecast' },
      { status: 500 }
    )
  }
}
