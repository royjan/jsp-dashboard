import { NextResponse } from 'next/server'
import { readQuery } from '@/lib/sqlite'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim()

  if (!q || q.length < 2) {
    return NextResponse.json({ items: [], summary: null })
  }

  // Support comma-separated search terms
  const terms = q.split(',').map(s => s.trim()).filter(Boolean)
  const whereClause = terms.map(() => `item_name LIKE ?`).join(' OR ')
  const params = terms.map(t => `%${t}%`)

  try {
    const items = readQuery(`
      SELECT
        item_code,
        item_name,
        CAST(qty AS INT) as qty,
        retail_price as price,
        ROUND(qty * retail_price) as capital_tied,
        CAST(sold_this_year AS INT) as sold_this_year,
        CAST(sold_last_year AS INT) as sold_last_year,
        CAST(sold_2y_ago AS INT) as sold_2y_ago,
        CAST(sold_3y_ago AS INT) as sold_3y_ago,
        ROUND(
          MIN(LOG10(MAX(qty * retail_price, 1)) * 11.5, 50)
          + CASE
              WHEN sold_this_year = 0 AND sold_last_year = 0 AND sold_2y_ago = 0 AND sold_3y_ago = 0 THEN 30
              WHEN sold_this_year = 0 AND sold_last_year = 0 AND sold_2y_ago = 0 THEN 20
              WHEN sold_this_year = 0 AND sold_last_year = 0 THEN 10
              ELSE 0
            END
          + MIN(qty / 3.0, 10)
          - MIN((sold_this_year + sold_last_year + sold_2y_ago + sold_3y_ago) * 3, 20)
        , 1) as scrap_score
      FROM item_snapshot
      WHERE qty > 0
        AND (${whereClause})
      ORDER BY scrap_score DESC
    `, params).rows

    const totalCapital = items.reduce((s: number, i: any) => s + (i.capital_tied || 0), 0)
    const totalUnits = items.reduce((s: number, i: any) => s + (i.qty || 0), 0)
    const deadItems = items.filter((i: any) => i.sold_this_year === 0)
    const deadCapital = deadItems.reduce((s: number, i: any) => s + (i.capital_tied || 0), 0)
    const neverSold = items.filter((i: any) => i.sold_this_year === 0 && i.sold_last_year === 0 && i.sold_2y_ago === 0 && i.sold_3y_ago === 0)
    const neverSoldCapital = neverSold.reduce((s: number, i: any) => s + (i.capital_tied || 0), 0)

    return NextResponse.json({
      items,
      summary: {
        total_items: items.length,
        total_units: totalUnits,
        total_capital: totalCapital,
        dead_items: deadItems.length,
        dead_capital: deadCapital,
        never_sold_items: neverSold.length,
        never_sold_capital: neverSoldCapital,
      },
    })
  } catch (error: any) {
    console.error('[dead-stock/search]', error)
    return NextResponse.json({ error: error.message, items: [], summary: null }, { status: 500 })
  }
}
