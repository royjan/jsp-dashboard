import { NextResponse } from 'next/server'
import { client } from '@/lib/finansit-client'
import { getItems } from '@/lib/services/analytics-service'

export const dynamic = 'force-dynamic'

/**
 * Dead-stock search.
 *
 * This route used to read `dashboard.item_snapshots`, and every capital figure it
 * reported was structurally zero. Measured 2026-08-16: the latest snapshot is
 * 2026-03-21 — five months stale — and of the 811 rows on that day, 565 carry stock
 * and **none** carries a price. `capital_tied` is `stock_qty * price`, so it was
 * always 0; `capitalTiedLog` (a log of that) contributed a flat 0 to every scrap
 * score, leaving the ranking to the sales penalty and a qty bonus. The three capital
 * totals in the summary were 0 on a page whose entire purpose is capital tied up in
 * dead stock, and the search only ever saw 811 items of a ~113k catalogue.
 *
 * None of that surfaced as an error, which is why it survived: a stale table and an
 * empty one both read as "no dead stock here".
 *
 * `getItems()` is the authoritative item source (live FINAPI + Redis, enriched with
 * the 4-year sales counters), and the sibling export-to-ebay route was already moved
 * onto it. Aggregating the chain from that same in-memory list also removes the old
 * per-chain SQL round-trip: the search was doing one query per matched chain, batched
 * ten at a time.
 */

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

type Row = {
  code: string
  name: string
  qty: number
  price: number
  capital_tied: number
  sold_this_year: number
  sold_last_year: number
  sold_2y_ago: number
  sold_3y_ago: number
}

/** One catalogue item, with the numeric coercion done once and in one place. */
function toRow(it: any): Row {
  const qty = Math.round(Number(it.stock_qty) || 0)
  const price = Number(it.price) || 0
  return {
    code: String(it.code ?? ''),
    name: String(it.name ?? ''),
    qty,
    price,
    capital_tied: Math.round(qty * price),
    sold_this_year: Math.round(Number(it.sold_this_year) || 0),
    sold_last_year: Math.round(Number(it.sold_last_year) || 0),
    sold_2y_ago: Math.round(Number(it.sold_2y_ago) || 0),
    sold_3y_ago: Math.round(Number(it.sold_3y_ago) || 0),
  }
}

/**
 * Scrap score, unchanged from the SQL version except that capital is now a real
 * number rather than a guaranteed zero — so the `capitalTiedLog` term does what it
 * was always meant to do and expensive dead stock finally outranks cheap dead stock.
 */
function scrapScore(qty: number, capital: number, sales: number[]): number {
  const [s1, s2, s3, s4] = sales
  const capitalTiedLog = Math.min(Math.log10(Math.max(capital, 1)) * 11.5, 50)
  const salesPenalty =
    s1 === 0 && s2 === 0 && s3 === 0 && s4 === 0 ? 30
    : s1 === 0 && s2 === 0 && s3 === 0 ? 20
    : s1 === 0 && s2 === 0 ? 10
    : 0
  const qtyBonus = Math.min(qty / 3.0, 10)
  const salesReduction = Math.min((s1 + s2 + s3 + s4) * 3, 20)
  return Math.round((capitalTiedLog + salesPenalty + qtyBonus - salesReduction) * 10) / 10
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim()

  if (!q || q.length < 2) {
    return NextResponse.json({ items: [], summary: null })
  }

  // Comma-separated terms, matched as OR — the same contract the SQL had.
  const terms = q.split(',').map(s => s.trim()).filter(Boolean).map(s => s.toLowerCase())

  try {
    const allItems = await getItems()
    // Index the whole catalogue by code once: the chain aggregation below looks up
    // every code of every matched chain, and rescanning ~113k items per chain is the
    // one way this could end up slower than the query it replaces.
    const byCode = new Map<string, Row>()
    for (const it of allItems) {
      const row = toRow(it)
      if (row.code) byCode.set(row.code.toUpperCase(), row)
    }

    const matched = [...byCode.values()].filter(
      r => r.qty > 0 && terms.some(t => r.name.toLowerCase().includes(t)),
    )

    const seen = new Set<string>()
    const items: any[] = []

    // Chain resolution is the only remote call left, so keep the bounded pool: bursts
    // of parallel item lookups against FINAPI fail silently (500 at once resolved ~6%).
    const batchSize = 10
    for (let i = 0; i < matched.length; i += batchSize) {
      const batch = matched.slice(i, i + batchSize)
      const resolved = await Promise.all(
        batch.map(async (item) => {
          const chain = await resolveItemChain(item.code)

          // Dedupe by canonical code
          if (seen.has(chain.canonical_code)) return null
          seen.add(chain.canonical_code)

          // Aggregate across the chain. A code in the history that the catalogue does
          // not carry simply contributes nothing, exactly as the old IN (...) did.
          const rows = chain.chain_codes
            .map((c: string) => byCode.get(String(c).toUpperCase()))
            .filter(Boolean) as Row[]
          if (rows.length === 0) rows.push(item)

          const totalQty = rows.reduce((s, r) => s + r.qty, 0)
          if (totalQty <= 0) return null
          const bestPrice = Math.max(...rows.map(r => r.price), 0)
          const totalCapital = rows.reduce((s, r) => s + r.capital_tied, 0)
          const soldThisYear = rows.reduce((s, r) => s + r.sold_this_year, 0)
          const soldLastYear = rows.reduce((s, r) => s + r.sold_last_year, 0)
          const sold2yAgo = rows.reduce((s, r) => s + r.sold_2y_ago, 0)
          const sold3yAgo = rows.reduce((s, r) => s + r.sold_3y_ago, 0)

          return {
            item_code: chain.canonical_code,
            item_name: chain.canonical_name || item.name,
            chain_codes: chain.chain_codes,
            qty: totalQty,
            price: bestPrice,
            capital_tied: totalCapital,
            sold_this_year: soldThisYear,
            sold_last_year: soldLastYear,
            sold_2y_ago: sold2yAgo,
            sold_3y_ago: sold3yAgo,
            scrap_score: scrapScore(totalQty, totalCapital,
              [soldThisYear, soldLastYear, sold2yAgo, sold3yAgo]),
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
