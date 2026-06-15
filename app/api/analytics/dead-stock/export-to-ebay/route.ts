export const maxDuration = 60

import { NextResponse } from 'next/server'
import { readQueryAsync } from '@/lib/sqlite'
import { client } from '@/lib/finansit-client'

/**
 * POST /api/analytics/dead-stock/export-to-ebay
 *
 * Fetches dead stock items and formats them for the jsp-ebay-uploader.
 * CHAIN-AWARE: resolves each item to its canonical code and aggregates
 * sales/stock across the entire item history chain.
 *
 * Body: { query?: string, item_codes?: string[], min_score?: number }
 *
 * Progressive discount logic based on years without sales:
 *   - 1+ years dead: 20% off
 *   - 2+ years dead: 35% off
 *   - 3+ years dead: 50% off
 */

/** Resolve item code to canonical and get chain codes */
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

/** Query SQLite for all codes in a chain and aggregate sales/stock */
async function aggregateChainData(chainCodes: string[]) {
  const placeholders = chainCodes.map(() => '?').join(',')
  const result = await readQueryAsync(`
    SELECT
      item_code,
      item_name,
      CAST(qty AS INT) as qty,
      retail_price as price,
      ROUND(qty * retail_price) as capital_tied,
      CAST(sold_this_year AS INT) as sold_this_year,
      CAST(sold_last_year AS INT) as sold_last_year,
      CAST(sold_2y_ago AS INT) as sold_2y_ago,
      CAST(sold_3y_ago AS INT) as sold_3y_ago
    FROM item_snapshot
    WHERE item_code IN (${placeholders})
  `, chainCodes)

  const rows = result.rows as any[]
  if (rows.length === 0) return null

  // Aggregate across all chain codes
  return {
    total_qty: rows.reduce((s, r) => s + (r.qty || 0), 0),
    best_price: Math.max(...rows.map(r => r.price || 0)),
    total_capital: rows.reduce((s, r) => s + (r.capital_tied || 0), 0),
    sold_this_year: rows.reduce((s, r) => s + (r.sold_this_year || 0), 0),
    sold_last_year: rows.reduce((s, r) => s + (r.sold_last_year || 0), 0),
    sold_2y_ago: rows.reduce((s, r) => s + (r.sold_2y_ago || 0), 0),
    sold_3y_ago: rows.reduce((s, r) => s + (r.sold_3y_ago || 0), 0),
    // Use name from the row with highest stock (most likely current)
    best_name: rows.sort((a, b) => (b.qty || 0) - (a.qty || 0))[0]?.item_name || '',
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { query, item_codes, min_score = 50 } = body

    if (!query && (!item_codes || !Array.isArray(item_codes) || item_codes.length === 0)) {
      return NextResponse.json(
        { error: 'Either "query" or "item_codes" is required' },
        { status: 400 }
      )
    }

    // Step 1: Get raw items from SQLite (same as before for initial filtering)
    let rawItems: any[]

    if (item_codes && item_codes.length > 0) {
      const placeholders = item_codes.map(() => '?').join(',')
      const result = await readQueryAsync(`
        SELECT item_code, item_name, CAST(qty AS INT) as qty, retail_price as price,
          ROUND(qty * retail_price) as capital_tied,
          CAST(sold_this_year AS INT) as sold_this_year,
          CAST(sold_last_year AS INT) as sold_last_year,
          CAST(sold_2y_ago AS INT) as sold_2y_ago,
          CAST(sold_3y_ago AS INT) as sold_3y_ago
        FROM item_snapshot
        WHERE qty > 0 AND item_code IN (${placeholders})
      `, item_codes)
      rawItems = result.rows
    } else {
      const terms = query!.split(',').map((s: string) => s.trim()).filter(Boolean)
      const whereClause = terms.map(() => `item_name LIKE ?`).join(' OR ')
      const params = terms.map((t: string) => `%${t}%`)

      const result = await readQueryAsync(`
        SELECT item_code, item_name, CAST(qty AS INT) as qty, retail_price as price,
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
        WHERE qty > 0 AND (${whereClause})
        ORDER BY scrap_score DESC
      `, params)
      rawItems = result.rows.filter((i: any) => (i.scrap_score || 0) >= min_score)
    }

    // Step 2: Resolve chains and aggregate sales across ALL codes in each chain
    const seen = new Set<string>() // dedupe by canonical code
    const exportItems: any[] = []

    // Batch resolve chains (limit concurrency to 10)
    const batchSize = 10
    for (let i = 0; i < rawItems.length; i += batchSize) {
      const batch = rawItems.slice(i, i + batchSize)
      const resolved = await Promise.all(
        batch.map(async (item: any) => {
          const chain = await resolveItemChain(item.item_code)

          // Skip if we already processed this canonical code
          if (seen.has(chain.canonical_code)) return null
          seen.add(chain.canonical_code)

          // Aggregate sales/stock across entire chain
          const aggregated = await aggregateChainData(chain.chain_codes)
          if (!aggregated || aggregated.total_qty <= 0) return null

          // Use canonical name from API, fall back to SQLite name
          const itemName = chain.canonical_name || aggregated.best_name || item.item_name

          // Determine years dead using AGGREGATED sales (across all chain codes)
          let yearsDead = 0
          if (aggregated.sold_this_year === 0 && aggregated.sold_last_year === 0 && aggregated.sold_2y_ago === 0 && aggregated.sold_3y_ago === 0) {
            yearsDead = 4
          } else if (aggregated.sold_this_year === 0 && aggregated.sold_last_year === 0 && aggregated.sold_2y_ago === 0) {
            yearsDead = 3
          } else if (aggregated.sold_this_year === 0 && aggregated.sold_last_year === 0) {
            yearsDead = 2
          } else if (aggregated.sold_this_year === 0) {
            yearsDead = 1
          }

          // Skip items that aren't actually dead after chain aggregation
          if (yearsDead === 0) return null

          // Progressive discount
          let discountPct = 0
          if (yearsDead >= 3) discountPct = 50
          else if (yearsDead >= 2) discountPct = 35
          else if (yearsDead >= 1) discountPct = 20

          const originalPrice = aggregated.best_price
          const discountedPrice = Math.round(originalPrice * (1 - discountPct / 100) * 100) / 100

          return {
            item_code: chain.canonical_code,      // Always use canonical
            original_code: item.item_code,         // What the user searched
            item_name: itemName,                   // Canonical name from API
            chain_codes: chain.chain_codes,        // Full chain for reference
            stock_qty: aggregated.total_qty,       // Aggregated across chain
            original_price_ils: originalPrice,
            discounted_price_ils: discountedPrice,
            discount_pct: discountPct,
            years_dead: yearsDead,
            capital_tied: aggregated.total_capital,
            sold_this_year: aggregated.sold_this_year,
            sold_last_year: aggregated.sold_last_year,
            sold_2y_ago: aggregated.sold_2y_ago,
            sold_3y_ago: aggregated.sold_3y_ago,
            scrap_score: item.scrap_score || 0,
          }
        })
      )
      exportItems.push(...resolved.filter(Boolean))
    }

    return NextResponse.json({
      items: exportItems,
      count: exportItems.length,
      total_capital: exportItems.reduce((s: number, i: any) => s + i.capital_tied, 0),
      generated_at: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('[API /dead-stock/export-to-ebay] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to export dead stock' },
      { status: 500 }
    )
  }
}
