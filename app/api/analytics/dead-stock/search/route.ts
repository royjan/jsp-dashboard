import { NextResponse } from 'next/server'
import { readQueryAsync } from '@/lib/neon-read'
import { client } from '@/lib/finansit-client'

export const dynamic = 'force-dynamic'

/** Resolve item code to canonical and get all chain codes */
async function resolveItemChain(code: string) {
  try {
    const history = await client.items.getHistory(code)
    return {
      canonical_code: history.canonical_code,
      canonical_name: history.canonical_name,
      chain_codes: history.item_id_history || [code],
    }
  } catch {
    return { canonical_code: code, canonical_name: null, chain_codes: [code] }
  }
}

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
    // Step 1: Search the latest item_snapshots for matching items.
    // (Schema: stock_qty, price, sold_this_year, sold_last_year — there is no
    // 2y/3y-ago column in dashboard.item_snapshots, so those are 0 here.)
    const rawItems = (await readQueryAsync(`
      SELECT
        item_code,
        item_name,
        CAST(stock_qty AS INT) as qty,
        price as price,
        ROUND(stock_qty * price) as capital_tied,
        CAST(sold_this_year AS INT) as sold_this_year,
        CAST(sold_last_year AS INT) as sold_last_year,
        0 as sold_2y_ago,
        0 as sold_3y_ago
      FROM item_snapshots
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM item_snapshots)
        AND stock_qty > 0
        AND (${whereClause})
    `, params)).rows as any[]

    // Step 2: Resolve chains and aggregate sales across ALL codes per chain
    const seen = new Set<string>()
    const items: any[] = []

    const batchSize = 10
    for (let i = 0; i < rawItems.length; i += batchSize) {
      const batch = rawItems.slice(i, i + batchSize)
      const resolved = await Promise.all(
        batch.map(async (item: any) => {
          const chain = await resolveItemChain(item.item_code)

          // Dedupe by canonical code
          if (seen.has(chain.canonical_code)) return null
          seen.add(chain.canonical_code)

          // Aggregate across chain
          const chainPlaceholders = chain.chain_codes.map(() => '?').join(',')
          const chainResult = (await readQueryAsync(`
            SELECT
              CAST(stock_qty AS INT) as qty,
              price as price,
              ROUND(stock_qty * price) as capital_tied,
              CAST(sold_this_year AS INT) as sold_this_year,
              CAST(sold_last_year AS INT) as sold_last_year,
              0 as sold_2y_ago,
              0 as sold_3y_ago
            FROM item_snapshots
            WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM item_snapshots)
              AND item_code IN (${chainPlaceholders})
          `, chain.chain_codes)).rows as any[]

          const totalQty = chainResult.reduce((s: number, r: any) => s + (r.qty || 0), 0)
          const bestPrice = Math.max(...chainResult.map((r: any) => r.price || 0), 0)
          const totalCapital = chainResult.reduce((s: number, r: any) => s + (r.capital_tied || 0), 0)
          const soldThisYear = chainResult.reduce((s: number, r: any) => s + (r.sold_this_year || 0), 0)
          const soldLastYear = chainResult.reduce((s: number, r: any) => s + (r.sold_last_year || 0), 0)
          const sold2yAgo = chainResult.reduce((s: number, r: any) => s + (r.sold_2y_ago || 0), 0)
          const sold3yAgo = chainResult.reduce((s: number, r: any) => s + (r.sold_3y_ago || 0), 0)

          if (totalQty <= 0) return null

          // Compute scrap score using aggregated data
          const capitalTiedLog = Math.min(Math.log10(Math.max(totalQty * bestPrice, 1)) * 11.5, 50)
          const salesPenalty = soldThisYear === 0 && soldLastYear === 0 && sold2yAgo === 0 && sold3yAgo === 0 ? 30
            : soldThisYear === 0 && soldLastYear === 0 && sold2yAgo === 0 ? 20
            : soldThisYear === 0 && soldLastYear === 0 ? 10
            : 0
          const qtyBonus = Math.min(totalQty / 3.0, 10)
          const salesReduction = Math.min((soldThisYear + soldLastYear + sold2yAgo + sold3yAgo) * 3, 20)
          const scrapScore = Math.round((capitalTiedLog + salesPenalty + qtyBonus - salesReduction) * 10) / 10

          return {
            item_code: chain.canonical_code,
            item_name: chain.canonical_name || item.item_name,
            chain_codes: chain.chain_codes,
            qty: totalQty,
            price: bestPrice,
            capital_tied: totalCapital,
            sold_this_year: soldThisYear,
            sold_last_year: soldLastYear,
            sold_2y_ago: sold2yAgo,
            sold_3y_ago: sold3yAgo,
            scrap_score: scrapScore,
          }
        })
      )
      items.push(...resolved.filter(Boolean))
    }

    // Sort by scrap score descending
    items.sort((a: any, b: any) => (b.scrap_score || 0) - (a.scrap_score || 0))

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
