export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { fetchMarginAnalytics, type FinapiMarginRow } from '@/lib/finansit-client'
import { getItems, getCanonicalizer, getCategorizer, foldByChain } from '@/lib/services/analytics-service'
import { getCached, setCache } from '@/lib/redis-client'
import { CACHE_TTL } from '@/lib/constants'

// v4: cost/margin no longer computed here. FINAPI's /api/analytics/margin owns the
// arithmetic now (the MCP calls the same endpoint, so the three consumers can no longer
// disagree about one business figure), and it returns things this route could not get
// from Neon at all: the AGE of each cost, a second price list alongside, and a below-cost
// list. Bumping the key rather than waiting out the TTL — a v3 payload has no cost_date,
// no compare column and no distribution, and the page would render those as empty.
const CACHE_KEY = 'analytics:margin:v5'   // v5: suspect costs off every board, not just bestMargin

// How many items get a live cost lookup on FINAPI's side. 1000 covers ~97% of revenue on
// this catalogue while staying inside the 55s client timeout on a cold FINAPI cache; the
// rankings below are explicitly scoped to it rather than implying the whole catalogue.
const COST_POOL = 1000

/** Revenue floor for the "best margin %" board. Without it the winner is a single
 *  ₪20 sale at 95% — true, useless, and it pushes the real answer off the list. */
const BEST_MARGIN_MIN_REVENUE = 5000

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
    // getItems() (live FINAPI + Redis) fixes the name and the price. It does not carry a
    // usable category — `categories` is null on every item sampled and `group` is the
    // placeholder '0000' on most — which is why byCategory was two buckets on a catalogue of
    // 33,587 classified parts. The classification lives in erp.item_categories and is what
    // getCategorizer() reads; itemCategory() remains the fallback for the unclassified.
    const itemsByCode = new Map<string, any>()
    for (const it of await getItems()) {
      const code = String(it.code ?? '').toUpperCase()
      if (code) itemsByCode.set(code, it)
    }
    const categoryOf = await getCategorizer()
    const catOf = (code: string) =>
      categoryOf(String(code || ''), itemsByCode.get(String(code || '').toUpperCase()))

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

    // Cost, margin, profit and the second price list: all from FINAPI, which reads the
    // live 7ITP rows. Degrades to an empty map on failure, exactly as fetchBatchCost did —
    // the page then renders revenue/quantity/categories with "cost pending" rather than
    // nothing, which is the whole reason the Neon half above stays local.
    const finapi = await fetchMarginAnalytics({
      pool: COST_POOL,
      limit: COST_POOL,
      sort: 'revenue',
      cost_price_code: '06',
      compare_price_code: '12',
    }).catch((e: unknown) => {
      console.error('[Margin] FINAPI margin unavailable:', e)
      return null
    })

    const finapiRows: FinapiMarginRow[] = finapi?.rows ?? []
    const costRowByCode = new Map<string, FinapiMarginRow>()
    for (const r of finapiRows) {
      const k = String(r.item_code || '').toUpperCase()
      if (k) costRowByCode.set(k, r)
    }

    interface FoldedRow {
      item_code: string
      item_name?: string | null
      category?: string | null
      revenue: number | string
      quantity: number | string
      snapshot_price?: number | string | null
    }

    /** Join one folded Neon row to its FINAPI cost row. Both are keyed by the CANONICAL
     *  code (foldByChain here, batch_resolve_canonical there), so this is a direct hit —
     *  but the two sides fold independently, so a code missing from the map means "not in
     *  the cost pool", never "no cost exists". Those stay margin_pct: null. */
    const enrich = (r: FoldedRow) => {
      const revenue = Number(r.revenue) || 0
      const quantity = Number(r.quantity) || 0
      const fin = costRowByCode.get(String(r.item_code || '').toUpperCase())
      // Prefer the snapshot price; fall back to derived avg sell price.
      const snapPrice = r.snapshot_price != null ? Number(r.snapshot_price) : 0
      const avg_price = snapPrice > 0 ? snapPrice : quantity > 0 ? revenue / quantity : 0
      const row: MarginRow = {
        item_code: r.item_code,
        item_name: r.item_name,
        category: r.category,
        revenue,
        quantity,
        avg_price,
        cost: fin?.cost ?? null,
      }
      return {
        ...row,
        cost: fin?.cost ?? null,
        // FINAPI's margin is computed off ITS avg_price (revenue/qty). Recomputing here
        // against the live retail snapshot would give a different number under the same
        // label, so the server's figure wins and estimateMargin() only covers the rows
        // FINAPI did not reach.
        margin_pct: fin?.margin_pct ?? estimateMargin(row),
        profit: fin?.profit ?? null,
        cost_date: fin?.cost_date ?? null,
        cost_stale: fin?.cost_stale ?? false,
        cost_suspect: fin?.cost_suspect ?? false,
        compare_price: fin?.compare_price ?? null,
        compare_margin_pct: fin?.compare_margin_pct ?? null,
        compare_gap: fin?.compare_gap ?? null,
        in_cost_pool: fin != null,
      }
    }

    const byItem = byItemResult.rows.map(enrich)

    // Rankings run over the WHOLE cost pool, not the 100 rows the table shows — the
    // best-margin part is very rarely also a top-100-by-revenue part, and ranking the
    // table's slice would have answered a different question while looking right.
    const pooled = foldedSales
      .filter((r: any) => costRowByCode.has(String(r.item_code || '').toUpperCase()))
      .map((r: any) => {
        const it = itemsByCode.get(String(r.item_code || '').toUpperCase())
        return enrich({
          item_code: r.item_code,
          item_name: it?.name || r.sales_name,
          category: catOf(r.item_code),
          revenue: r.revenue,
          quantity: r.quantity,
          snapshot_price: it?.price ?? null,
        })
      })
      .filter((r) => r.margin_pct != null)

    // This route re-sorts the pool locally (it fetches once, by revenue, and derives all
    // three boards), so FINAPI's own suspect-cost exclusion — which applies to ITS sort
    // param — does not cover these. It has to be repeated here, on every costed board and
    // not just the percentage one: a ₪0.82 "cost" on a ₪59,110 door makes the profit
    // ≈ the revenue, and 9002W0 topped this very bestProfit list on prod after the first
    // deploy while bestMargin was already clean. The rows stay in the table below.
    const costable = pooled.filter((r) => !r.cost_suspect)

    const bestMargin = [...costable]
      .filter((r) => r.revenue >= BEST_MARGIN_MIN_REVENUE)
      .sort((a, b) => (b.margin_pct ?? 0) - (a.margin_pct ?? 0))
      .slice(0, 20)

    const bestProfit = [...costable]
      .sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0))
      .slice(0, 20)

    // Below-cost is the one board a suspect row cannot reach anyway (0.82 gives a +100%
    // margin, not a negative one), but filtering keeps the rule in one place rather than
    // resting on that coincidence.
    const belowCost = [...costable]
      .filter((r) => (r.margin_pct ?? 0) < 0)
      .sort((a, b) => (a.profit ?? 0) - (b.profit ?? 0))
      .slice(0, 20)

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
    // The portfolio margin comes from FINAPI's revenue-weighted figure over the whole
    // pool. weightedMargin() over the table's 100 rows would answer a narrower question
    // under the same label.
    const fsum = finapi?.summary ?? null
    const overallMargin = fsum?.gross_margin_pct ?? weightedMargin(costedItems)
    const pooledCosted = pooled.length

    const response = {
      summary: {
        total_revenue: Number(s.total_revenue) || 0,
        total_quantity: Number(s.total_quantity) || 0,
        // Distinct PARTS, not distinct codes: COUNT(DISTINCT item_code) counted
        // each member of a supersession chain as its own item.
        items_evaluated: foldedSales.length || Number(s.items_evaluated) || 0,
        est_gross_margin_pct: overallMargin,
        // Shekels, not just a percentage — a 38% margin on ₪7.4M and on ₪74k are the
        // same number and very different businesses.
        gross_profit: fsum?.gross_profit ?? null,
        cost_of_goods: fsum?.cost_of_goods ?? null,
        costed_revenue: fsum?.costed_revenue ?? null,
        items_costed: pooledCosted,
        // The pool is the ranking scope. Reported, never implied.
        cost_pool: fsum?.pool ?? 0,
        coverage_pct: fsum?.coverage_pct ?? 0,
        // Not a footnote — these are 7ITP rows someone should fix, and the page says so
        // rather than just quietly ranking around them.
        suspect_cost_items: fsum?.suspect_cost_items ?? 0,
      },
      byCategory,
      byItem,
      bestMargin,
      bestProfit,
      belowCost: {
        count: costable.filter((r) => (r.margin_pct ?? 0) < 0).length,
        lost_profit: finapi?.below_cost?.lost_profit ?? null,
        items: belowCost,
      },
      distribution: finapi?.distribution ?? null,
      freshness: finapi?.data_freshness ?? null,
      cost_available: pooledCosted > 0,
      costed_item_count: pooledCosted,
      note_he: pooledCosted > 0
        ? `מרווח גולמי לפי מחיר עלות (מחירון 06) עבור ${pooledCosted} פריטים — הדירוגים מחושבים על מאגר זה בלבד.`
        : 'מרווח גולמי בהמתנה — לא נמצא מחיר עלות (מחירון 06) לפריטים אלו.',
      note_en: pooledCosted > 0
        ? `Gross margin from cost price (list 06) for ${pooledCosted} items — rankings are scoped to that pool.`
        : 'Gross margin pending — no cost price (list 06) found for these items.',
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
      bestMargin: [],
      bestProfit: [],
      belowCost: { count: 0, lost_profit: null, items: [] },
      distribution: null,
      freshness: null,
      cost_available: false,
    })
  }
}
