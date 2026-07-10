import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getItems } from '@/lib/services/analytics-service'
import { readQueryAsync } from '@/lib/neon-read'
import { classifySize, matchScore, yearsOfStock } from '@/lib/ebay-size'

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
    const year2y = now.getFullYear() - 2 // 2y-ago = the "sold_2y_ago" year

    // 2-years-ago units per item, from the historical table.
    const twoYrRows = (await readQueryAsync(
      `SELECT item_code, units_sold FROM yearly_item_sales WHERE year = ?`,
      [year2y],
    )).rows as Array<{ item_code: string; units_sold: number }>
    const sold2yMap = new Map<string, number>()
    for (const r of twoYrRows) sold2yMap.set(r.item_code, Number(r.units_sold) || 0)

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

      out.push({
        code, name, size,
        price: Math.round(price),
        stock: Math.round(stock),
        sold_this_year: Math.max(0, Math.round(sold2026)),
        sold_2025: Math.max(0, Math.round(sold2025)),
        sold_2024: Math.max(0, Math.round(sold2024)),
        demand: Math.round(demand),
        years_of_stock: Math.round(yearsOfStock(stock, sold2025, sold2026) * 10) / 10,
        match: matchScore(price, stock, sold2025, sold2026),
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
