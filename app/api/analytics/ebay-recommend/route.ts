import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getItems } from '@/lib/services/analytics-service'
import { readQueryAsync } from '@/lib/neon-read'
import { classifySize, deadnessScore, matchScore, yearsOfStock } from '@/lib/ebay-size'
import { marketFlag } from '@/lib/ebay-browse'
import type { FinansitItem } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 60

// eBay sell-abroad recommendations: expensive parts that are cheap to ship
// (small/medium) and have proven recent demand. Catalog (name/price/stock/
// this+last-year sold) comes from the reliable FINAPI bulk (getItems); the
// 2-years-ago figure comes from dashboard.yearly_item_sales (accurate,
// void-aware ERP 7IPQ counters, loaded from the Btrieve year folders).
export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const minPrice = Number(searchParams.get('min_price') ?? 1000)

    const now = new Date()
    const currentYear = now.getFullYear()
    const year2y = currentYear - 2 // 2y-ago = the "sold_2y_ago" year

    // One pass over the historical table gives us two things per item_code:
    //   · sold2yMap    — units sold in the 2-years-ago year (for the sold_2024 column)
    //   · firstYearMap — the earliest year the code appears (its "first seen" signal).
    // yearly_item_sales spans 2020–now (accurate, void-aware ERP 7IPQ counters), so
    // first-seen is capped at 2020 — plenty to tell a new part from an established one.
    const yisRows = (await readQueryAsync(
      `SELECT item_code, year, units_sold FROM yearly_item_sales`,
    )).rows as Array<{ item_code: string; year: number; units_sold: number }>
    const sold2yMap = new Map<string, number>()
    const firstYearMap = new Map<string, number>()
    for (const r of yisRows) {
      const yr = Number(r.year)
      if (yr === year2y) sold2yMap.set(r.item_code, Number(r.units_sold) || 0)
      const prev = firstYearMap.get(r.item_code)
      if (prev === undefined || yr < prev) firstYearMap.set(r.item_code, yr)
    }

    // First-seen year for a whole chain = the earliest first-seen across ALL its
    // codes. A part-id renamed 3 years ago still counts as old if an alias in its
    // chain goes back further (e.g. 1920LL ← [9819938480, 1675941280]).
    const chainFirstYear = (it: FinansitItem): number | null => {
      const codes = new Set<string>([it.code])
      for (const c of it.alias_codes || []) codes.add(c)
      for (const c of it.chain_history || []) codes.add(c)
      for (const c of it.item_id_history || []) codes.add(c)
      let min: number | null = null
      for (const c of codes) {
        const y = firstYearMap.get(c)
        if (y !== undefined && (min === null || y < min)) min = y
      }
      return min
    }

    // eBay price comparison, populated by /api/cron/ebay-prices. Keyed by any
    // code so the chain lookup below finds it whichever code was searched.
    type EbayRow = { item_code: string; best_market: string | null; median_ils: number | null; match_count: number | null; oem: boolean | null; best_url: string | null; checked_at: string | null }
    const ebayRows = (await readQueryAsync(
      `SELECT item_code, best_market, median_ils, match_count, oem, best_url, checked_at FROM dashboard.ebay_price_compare WHERE median_ils IS NOT NULL`,
    ).catch(() => ({ rows: [] as EbayRow[] }))).rows as EbayRow[]
    const ebayMap = new Map<string, EbayRow>()
    for (const r of ebayRows) ebayMap.set(r.item_code, r)
    const chainEbay = (it: FinansitItem): EbayRow | null => {
      for (const c of [it.code, ...(it.alias_codes || []), ...(it.chain_history || []), ...(it.item_id_history || [])]) {
        const hit = ebayMap.get(c)
        if (hit) return hit
      }
      return null
    }

    const items = await getItems()
    const out: any[] = []
    for (const it of items) {
      const name = (it.name || '').trim()
      const code = it.code
      const price = it.price || 0
      const stock = it.stock_qty || 0
      const sold2026 = it.sold_this_year || 0
      const sold2025 = it.sold_last_year || 0
      const sold2024 = sold2yMap.get(code) || 0
      const demand = sold2025 + sold2024

      // skip junk placeholder rows + fee/discount pseudo-items
      if (!name || name.length < 2 || ['!', '.', '-', '----'].includes(name)) continue
      if (code.length <= 3 && /^\d+$/.test(code)) continue
      // filters: in stock + expensive (NO sales floor — dead/unsold stock is the target)
      if (stock <= 0 || price < minPrice) continue

      const size = classifySize(name)
      if (size === 'large') continue // too bulky/heavy to ship abroad

      const firstSeenYear = chainFirstYear(it)
      const ageYears = firstSeenYear === null ? null : currentYear - firstSeenYear

      // Best "new" eBay comparable across marketplaces (from the warm-cache).
      const eb = chainEbay(it)
      const ebayIls = eb?.median_ils ?? null
      const ebaySpread = ebayIls != null && price > 0 ? Math.round((ebayIls / Math.round(price) - 1) * 100) : null

      out.push({
        code, name, size,
        price: Math.round(price),
        stock: Math.round(stock),
        sold_this_year: Math.max(0, Math.round(sold2026)),
        sold_2025: Math.max(0, Math.round(sold2025)),
        sold_2024: Math.max(0, Math.round(sold2024)),
        demand: Math.round(demand),
        years_of_stock: Math.round(yearsOfStock(stock, sold2025, sold2026) * 10) / 10,
        deadness: Math.round(100 * deadnessScore(stock, sold2025, sold2026)),
        match: matchScore(price, size, stock, sold2025, sold2026),
        first_seen_year: firstSeenYear,
        // Years the part (or any code in its chain) has existed in the system.
        // null = no sales on record since 2020 — age unknown (could be old dead
        // stock or brand-new); the UI keeps these rather than hide dead stock.
        age_years: ageYears,
        // Best "new" eBay asking-price comparable (null until the warm-cache has
        // checked this part, or when no comparable exists on eBay).
        ebay_ils: ebayIls,
        ebay_market: eb?.best_market ?? null,
        ebay_flag: marketFlag(eb?.best_market),
        ebay_match_count: eb?.match_count ?? null,
        ebay_spread_pct: ebaySpread, // eBay median vs our price, %  (negative = eBay cheaper)
        ebay_oem: eb?.oem ?? null,   // true = comparable is genuine/OEM (fair vs our stock)
        ebay_url: eb?.best_url ?? null, // link to the best-match eBay listing
      })
    }
    out.sort((a, b) => b.match - a.match)

    const small = out.filter(x => x.size === 'small').length
    return NextResponse.json({
      count: out.length,
      small,
      medium: out.length - small,
      avg_price: out.length ? Math.round(out.reduce((s, x) => s + x.price, 0) / out.length) : 0,
      capital_tied: out.reduce((s, x) => s + x.price * x.stock, 0),
      items: out,
    })
  } catch (error) {
    console.error('[ebay-recommend] failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed' },
      { status: 500 },
    )
  }
}
