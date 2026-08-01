export const maxDuration = 60

import { NextResponse } from 'next/server'
import { query as dbQuery } from '@/lib/db'
import { getItems, getChainMap, looksLikeCodeNotName } from '@/lib/services/analytics-service'
import { getCached, setCache } from '@/lib/redis-client'
import { CACHE_TTL } from '@/lib/constants'
import { fixRtlItemName } from '@/lib/rtl-fix'
import { client } from '@/lib/finansit-client'

type UrgencyLevel = 'critical' | 'warning' | 'watch' | 'ok'

/**
 * Column comparator for server-side sorting: nulls/blanks last, numbers
 * numerically, text with Hebrew-aware collation. Deliberately mirrors
 * `compareValues` in components/shared/sortable-table.tsx (including the way
 * the caller's direction flip also flips the null placement) so moving the
 * sort to the server doesn't change the order users are used to.
 */
function compareValues(a: unknown, b: unknown): number {
  const aNil = a === null || a === undefined || a === ''
  const bNil = b === null || b === undefined || b === ''
  if (aNil && bNil) return 0
  if (aNil) return 1
  if (bNil) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const sa = String(a)
  const sb = String(b)
  const na = Number(sa)
  const nb = Number(sb)
  if (sa.trim() !== '' && sb.trim() !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
  return sa.localeCompare(sb, 'he')
}

function getUrgency(days: number | null): UrgencyLevel {
  if (days === null) return 'ok' // infinite stock (no demand)
  if (days < 30) return 'critical'
  if (days < 60) return 'warning'
  if (days < 90) return 'watch'
  return 'ok'
}

// The FULL computed forecast (every candidate item, unfiltered and unsorted)
// is cached under ONE key; limit/urgency/search/sort are applied per request
// in memory (~10k rows, milliseconds). Caching per param-combo — the previous
// design — meant each combo paid the full recompute and only the single
// warmed combo was ever fast.
const FULL_CACHE_KEY = 'stock-forecast:full:v1'

type ForecastRow = {
  item_code: string
  alias_codes: string[]
  item_name: string
  current_stock: number
  incoming_qty: number
  ordered_qty: number
  pipeline_qty: number
  price: number
  predicted_monthly_demand: number
  stock_out_date: string | null
  days_until_stockout: number | null
  days_with_pipeline: number | null
  confidence: number
  urgency: UrgencyLevel
  stock_urgency: UrgencyLevel
}

async function computeForecastRows(): Promise<ForecastRow[]> {
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

  return allItems
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
        // Superseded codes merged into this row — searching an old code must
        // still find the canonical row now that chains actually merge.
        alias_codes: item.alias_codes || [],
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
}

/** Full forecast from cache, recomputing on miss or refresh=1 (warm-cache cron
 *  recomputes and re-SETs so the Redis TTL restarts on each warm run). */
async function getForecastRows(forceRefresh: boolean): Promise<ForecastRow[]> {
  if (!forceRefresh) {
    const cached = await getCached<ForecastRow[]>(FULL_CACHE_KEY)
    if (cached && cached.length > 0) return cached
  }
  const rows = await computeForecastRows()
  await setCache(FULL_CACHE_KEY, rows, CACHE_TTL.ANALYTICS)
  return rows
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const urgencyFilter = searchParams.get('urgency') || ''
    // Search and sort are applied here, over the whole result set, rather than
    // in the browser over the rows that happen to be loaded — otherwise
    // "sort by reliability" only ranks the current page and the genuinely
    // worst items never appear.
    const search = (searchParams.get('q') || '').trim().toLowerCase()
    const sortKey = searchParams.get('sort') || ''
    const sortDir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc'
    const forceRefresh = searchParams.get('refresh') === '1'

    const allRows = await getForecastRows(forceRefresh)

    const forecastRows = allRows
      // Filter by urgency if requested
      .filter(item => {
        if (!urgencyFilter) return item.urgency !== 'ok' || item.predicted_monthly_demand > 0
        const filters = urgencyFilter.split(',')
        return filters.includes(item.urgency)
      })
      // Free-text search on code/name/superseded codes, before sorting and paging.
      .filter(item => {
        if (!search) return true
        return (
          (item.item_code || '').toLowerCase().includes(search) ||
          (item.item_name || '').toLowerCase().includes(search) ||
          item.alias_codes.some(c => (c || '').toLowerCase().includes(search))
        )
      })
      .sort((a: any, b: any) => {
        const urgencyOrder: Record<string, number> = { critical: 0, warning: 1, watch: 2, ok: 3 }
        // Explicit column sort when the user picked one …
        if (sortKey) {
          const va = a[sortKey]
          const vb = b[sortKey]
          // Urgency sorts by severity, not alphabetically.
          const cmp =
            sortKey === 'urgency'
              ? (urgencyOrder[va] ?? 3) - (urgencyOrder[vb] ?? 3)
              : compareValues(va, vb)
          if (cmp !== 0) return sortDir === 'asc' ? cmp : -cmp
        }
        // … otherwise (and as the tie-break) the default triage order.
        const diff = (urgencyOrder[a.urgency] || 3) - (urgencyOrder[b.urgency] || 3)
        if (diff !== 0) return diff
        return (a.days_with_pipeline ?? 9999) - (b.days_with_pipeline ?? 9999)
      })

    // Totals over the WHOLE filtered set, before the row cap. The page's KPI
    // cards used to count the returned rows, so a 200-row page reported at most
    // 200 critical items no matter how many actually exist.
    const summary = forecastRows.reduce(
      (acc, i) => {
        acc[i.urgency] = (acc[i.urgency] || 0) + 1
        acc.total++
        if (i.urgency === 'critical' || i.urgency === 'warning') {
          acc.value_at_risk += (i.current_stock || 0) * (i.price || 0)
        }
        return acc
      },
      { critical: 0, warning: 0, watch: 0, ok: 0, total: 0, value_at_risk: 0 } as Record<string, number>,
    )

    const items = forecastRows.slice(0, limit)

    // Last-mile name repair. The shared items cache resolves code-looking names
    // too, but only for the first N candidates catalogue-wide, so rows further
    // down still surface a barcode instead of a description (e.g. 1623180680 →
    // "0857428661"). Here the set is just this page, so the few stragglers can
    // be resolved directly — typically a handful of calls.
    //
    // The same pass fills a missing price. The bulk price feed carries an
    // item's OWN price; when it has none, the per-item endpoint resolves the
    // ERP's `price_source_code` chain and returns the price it inherits from
    // the source part (e.g. 1683121580 inherits 699.94 from 1611608580). So:
    // own price wins, inherited price is the fallback, 0 only if neither
    // exists. One fetch per row serves both repairs.
    const needsRepair = items.filter(
      i => looksLikeCodeNotName(i.item_name, i.item_code) || !i.price,
    )
    let repaired = 0
    if (needsRepair.length > 0) {
      const queue = [...needsRepair]
      const worker = async () => {
        for (let row = queue.shift(); row; row = queue.shift()) {
          try {
            const full = await client.items.get(row.item_code.toUpperCase())
            if (full?.name && !looksLikeCodeNotName(full.name, row.item_code)) {
              row.item_name = fixRtlItemName(full.name)
              repaired++
            }
            if (!row.price) {
              const inherited = Number(full?.price ?? full?.price_list_price) || 0
              if (inherited > 0) { row.price = inherited; repaired++ }
            }
          } catch {
            // Leave the code/zero showing rather than fail the page.
          }
        }
      }
      await Promise.allSettled(Array.from({ length: 6 }, worker))
      // The sliced rows share object identity with the full cached set, so the
      // repairs above already live in `allRows` — persist them so no later
      // request (any param combo) re-pays these FINAPI lookups.
      if (repaired > 0) await setCache(FULL_CACHE_KEY, allRows, CACHE_TTL.ANALYTICS)
    }

    return NextResponse.json({ items, summary })
  } catch (error) {
    console.error('[stock-forecast] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch stock forecast' },
      { status: 500 }
    )
  }
}
