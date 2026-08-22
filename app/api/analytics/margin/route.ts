export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { fetchBatchCost } from '@/lib/finansit-client'
import { getItems, itemCategory, getCanonicalizer, foldByChain } from '@/lib/services/analytics-service'
import { getCached, setCache } from '@/lib/redis-client'
import { CACHE_TTL } from '@/lib/constants'

const CACHE_KEY = 'analytics:margin:v2'

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

    // Sales come from Neon; category / name / price come from the LIVE catalogue.
    //
    // Both of these used to LEFT JOIN a `latest_snap` CTE over dashboard.item_snapshots,
    // and that join could not do its job. Measured 2026-08-16: the table holds 909
    // distinct items against monthly_sales' 4,266 (71 of the top-100 by revenue), its
    // newest row is 2026-03-21, its `price` is 0/NULL on every row after 2026-03-15 —
    // and its `category` is the EMPTY STRING on 2,664 of 2,668 rows ('0000' on the other
    // four). COALESCE only replaces NULL, so '' passed straight through and the whole
    // category breakdown collapsed into one unnamed bucket beside 'ללא קטגוריה'.
    //
    // getItems() (live FINAPI + Redis) fixes the name and the price. It does NOT fix the
    // category, because nothing can: the ERP has no per-item category to give — `categories`
    // is null on every item sampled and `group` is the placeholder '0000' on most of them.
    // See itemCategory(), which names that honestly instead of plotting a '0000' bucket. The
    // byCategory block below is therefore near-single-bucket by DATA, not by bug, and giving
    // this page a real dimension needs category data that does not exist yet.
    const itemsByCode = new Map<string, any>()
    for (const it of await getItems()) {
      const code = String(it.code ?? '').toUpperCase()
      if (code) itemsByCode.set(code, it)
    }
    const catOf = (code: string) =>
      itemCategory(itemsByCode.get(String(code || '').toUpperCase()))

    const salesByItem = await query(`
      SELECT
        item_code,
        MAX(item_name) AS sales_name,
        SUM(revenue::numeric)  AS revenue,
        SUM(quantity::numeric) AS quantity
      FROM dashboard.monthly_sales
      GROUP BY item_code
      HAVING SUM(revenue::numeric) > 0
      ORDER BY revenue DESC
    `)

    // Fold supersession chains before ranking. Two effects, both wrong without
    // it: one part's revenue splits across its codes and neither half makes the
    // top 100, and an alias row misses `itemsByCode` entirely (that map is keyed
    // by canonical code) so it renders with no live price and no category.
    const canon = await getCanonicalizer()
    const foldedSales = foldByChain(salesByItem.rows as any[], canon, {
      codeField: 'item_code',
      sum: ['revenue', 'quantity'],
      longest: ['sales_name'],
    }).sort((a: any, b: any) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0))

    const byItemResult = {
      rows: foldedSales.slice(0, 100).map((r: any) => {
        const it = itemsByCode.get(String(r.item_code || '').toUpperCase())
        return {
          item_code: r.item_code,
          item_name: it?.name || r.sales_name,
          category: catOf(r.item_code),
          revenue: r.revenue,
          quantity: r.quantity,
          // The live retail price, where the snapshot's was 0 on every recent row.
          snapshot_price: it?.price ?? null,
        }
      }),
    }

    // Category totals over EVERY selling item, not just the top 100 — same scope the
    // SQL GROUP BY had.
    const catAgg = new Map<string, { revenue: number; quantity: number; item_count: number }>()
    for (const r of foldedSales as any[]) {
      const k = catOf(r.item_code)
      const b = catAgg.get(k) || { revenue: 0, quantity: 0, item_count: 0 }
      b.revenue += Number(r.revenue) || 0
      b.quantity += Number(r.quantity) || 0
      b.item_count += 1
      catAgg.set(k, b)
    }
    const byCategoryResult = {
      rows: [...catAgg.entries()]
        .map(([category, v]) => ({ category, ...v }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 30),
    }

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
        // Distinct PARTS, not distinct codes: COUNT(DISTINCT item_code) counted
        // each member of a supersession chain as its own item.
        items_evaluated: foldedSales.length || Number(s.items_evaluated) || 0,
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
