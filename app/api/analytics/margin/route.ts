export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { fetchBatchCost } from '@/lib/finansit-client'
import { getCached, setCache } from '@/lib/redis-client'
import { CACHE_TTL } from '@/lib/constants'

const CACHE_KEY = 'analytics:margin:v1'

/**
 * Margin (מרווח) analytics.
 *
 * Revenue / quantity / avg sell price come from Neon (dashboard.monthly_sales +
 * item_snapshots). True cost lives in FINAPI under price_code 06 (COST) — fetched
 * per item via fetchBatchCost for the top items by revenue, then gross margin is
 * computed per item and revenue-weighted for categories / summary. estimateMargin()
 * still returns null when a cost is missing, so the page degrades gracefully.
 */

interface MarginRow {
  item_code?: string
  item_name?: string | null
  category?: string | null
  revenue: number
  quantity: number
  avg_price: number
  cost?: number | null // reserved — currently always null/undefined (no cost in Neon)
}

/**
 * Single source of truth for margin computation.
 * Returns gross margin % (0-100) when a real per-unit cost is known, else null.
 */
export function estimateMargin(row: MarginRow): number | null {
  const cost = row.cost
  if (cost == null || !Number.isFinite(cost) || cost <= 0) return null
  if (!Number.isFinite(row.avg_price) || row.avg_price <= 0) return null
  return ((row.avg_price - cost) / row.avg_price) * 100
}

export async function GET() {
  try {
    await initializeSecrets()

    const cached = await getCached<any>(CACHE_KEY)
    if (cached) return NextResponse.json(cached)

    // Latest snapshot date — used to attach current category / price / name.
    // Group sales by item across all years, join the most recent snapshot.
    const byItemResult = await query(`
      WITH latest_snap AS (
        SELECT DISTINCT ON (item_code)
          item_code, item_name, category, price
        FROM dashboard.item_snapshots
        ORDER BY item_code, snapshot_date DESC
      ),
      sales AS (
        SELECT
          item_code,
          MAX(item_name) AS sales_name,
          SUM(revenue::numeric)  AS revenue,
          SUM(quantity::numeric) AS quantity
        FROM dashboard.monthly_sales
        GROUP BY item_code
      )
      SELECT
        s.item_code,
        COALESCE(ls.item_name, s.sales_name) AS item_name,
        COALESCE(ls.category, 'ללא קטגוריה') AS category,
        s.revenue,
        s.quantity,
        ls.price AS snapshot_price
      FROM sales s
      LEFT JOIN latest_snap ls ON ls.item_code = s.item_code
      WHERE s.revenue > 0
      ORDER BY s.revenue DESC
      LIMIT 100
    `)

    const byCategoryResult = await query(`
      WITH latest_snap AS (
        SELECT DISTINCT ON (item_code) item_code, category
        FROM dashboard.item_snapshots
        ORDER BY item_code, snapshot_date DESC
      )
      SELECT
        COALESCE(ls.category, 'ללא קטגוריה') AS category,
        SUM(ms.revenue::numeric)  AS revenue,
        SUM(ms.quantity::numeric) AS quantity,
        COUNT(DISTINCT ms.item_code) AS item_count
      FROM dashboard.monthly_sales ms
      LEFT JOIN latest_snap ls ON ls.item_code = ms.item_code
      GROUP BY COALESCE(ls.category, 'ללא קטגוריה')
      HAVING SUM(ms.revenue::numeric) > 0
      ORDER BY revenue DESC
      LIMIT 30
    `)

    const summaryResult = await query(`
      SELECT
        SUM(revenue::numeric)  AS total_revenue,
        SUM(quantity::numeric) AS total_quantity,
        COUNT(DISTINCT item_code) AS items_evaluated
      FROM dashboard.monthly_sales
    `)

    // Real per-unit cost (FINAPI price_code 06 = COST) for the evaluated items.
    const itemCodes = byItemResult.rows
      .map((r: any) => String(r.item_code || '').toUpperCase())
      .filter(Boolean)
    const costMap = await fetchBatchCost(itemCodes).catch(() => ({} as Record<string, number>))

    const byItem = byItemResult.rows.map((r: any) => {
      const revenue = Number(r.revenue) || 0
      const quantity = Number(r.quantity) || 0
      // Prefer the snapshot price; fall back to derived avg sell price.
      const snapPrice = r.snapshot_price != null ? Number(r.snapshot_price) : 0
      const avg_price = snapPrice > 0 ? snapPrice : quantity > 0 ? revenue / quantity : 0
      const cost = costMap[String(r.item_code || '').toUpperCase()] ?? null
      const row: MarginRow = {
        item_code: r.item_code,
        item_name: r.item_name,
        category: r.category,
        revenue,
        quantity,
        avg_price,
        cost,
      }
      return { ...row, cost, margin_pct: estimateMargin(row) }
    })

    // Revenue-weighted gross margin over rows that have a known cost.
    const weightedMargin = (rows: any[]): number | null => {
      const rev = rows.reduce((sum, r) => sum + (r.revenue || 0), 0)
      if (rev <= 0) return null
      const profit = rows.reduce((sum, r) => sum + (r.revenue || 0) * ((r.margin_pct || 0) / 100), 0)
      return (profit / rev) * 100
    }
    const costedItems = byItem.filter((r: any) => r.margin_pct != null)

    // Per-category margin from the costed items in each category.
    const catRows = new Map<string, any[]>()
    for (const r of costedItems) {
      const k = (r.category as string) || 'ללא קטגוריה'
      if (!catRows.has(k)) catRows.set(k, [])
      catRows.get(k)!.push(r)
    }

    const byCategory = byCategoryResult.rows.map((r: any) => {
      const revenue = Number(r.revenue) || 0
      const quantity = Number(r.quantity) || 0
      const avg_price = quantity > 0 ? revenue / quantity : 0
      return {
        category: r.category as string,
        revenue,
        quantity,
        avg_price,
        item_count: Number(r.item_count) || 0,
        margin_pct: weightedMargin(catRows.get(r.category as string) || []),
      }
    })

    const s = summaryResult.rows[0] || {}
    const overallMargin = weightedMargin(costedItems)

    const response = {
      summary: {
        total_revenue: Number(s.total_revenue) || 0,
        total_quantity: Number(s.total_quantity) || 0,
        items_evaluated: Number(s.items_evaluated) || 0,
        est_gross_margin_pct: overallMargin,
      },
      byCategory,
      byItem,
      cost_available: costedItems.length > 0,
      costed_item_count: costedItems.length,
      note_he: costedItems.length > 0
        ? `מרווח גולמי מבוסס על מחיר עלות (FINAPI קוד 06) עבור ${costedItems.length} הפריטים המובילים בהכנסה.`
        : 'מרווח גולמי בהמתנה — לא נמצא מחיר עלות (FINAPI קוד 06) לפריטים אלו.',
      note_en: costedItems.length > 0
        ? `Gross margin from cost price (FINAPI code 06) for the top ${costedItems.length} items by revenue.`
        : 'Gross margin pending — no cost price (FINAPI code 06) found for these items.',
      cached_at: new Date().toISOString(),
    }

    await setCache(CACHE_KEY, response, CACHE_TTL.ANALYTICS)

    return NextResponse.json(response)
  } catch (error) {
    console.error('[Margin] Error:', error)
    // Never hard-crash the page — return 200 with an error field.
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to fetch margin analytics',
      summary: { total_revenue: 0, total_quantity: 0, items_evaluated: 0, est_gross_margin_pct: null },
      byCategory: [],
      byItem: [],
      cost_available: false,
    })
  }
}
