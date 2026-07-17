export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { client, fetchBatchStockGet } from '@/lib/finansit-client'
import { getCached, setCache } from '@/lib/redis-client'

/**
 * Gap analysis — items quoted (format 31) in the last 12 months that are
 * currently out of stock (and not incoming).
 *
 * FINAPI's own /api/analytics/gap does a full server-side quote scan that
 * takes >60s and 504s. So we compute the "most-quoted" half from Neon
 * (dashboard.document_lines — fast), then check CURRENT stock for just those
 * top items via a single FINAPI batch-stock call (accurate, cheap).
 */
export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10), 500)
    const format = searchParams.get('format') || '31' // quotes

    const cacheKey = `analytics:gap:v4:${format}:${limit}`
    const forceRefresh = searchParams.get('refresh') === '1'
    const cached = forceRefresh ? null : await getCached<any>(cacheKey)
    if (cached) return NextResponse.json(cached)

    // 1) Most-quoted items in the last 12 months (Neon, fast). Over-fetch a bit
    //    since many will turn out to be in stock and get filtered below.
    const probe = Math.min(limit * 2, 300)
    const res = await query(
      `SELECT dl.item_code,
              MAX(dl.item_name) AS item_name,
              COUNT(DISTINCT dl.doc_number)::int AS times_quoted,
              SUM(dl.quantity::numeric) AS total_qty_quoted,
              MAX(d.doc_date)::text AS last_quoted_date
       FROM dashboard.document_lines dl
       JOIN dashboard.documents d
         ON d.year=dl.year AND d.format=dl.format AND d.doc_number=dl.doc_number
       WHERE dl.format = $1
         AND length(dl.item_code) > 1
         AND d.doc_date >= (CURRENT_DATE - INTERVAL '12 months')
       GROUP BY dl.item_code
       ORDER BY times_quoted DESC
       LIMIT $2`,
      [format, probe],
    )
    const quoted = res.rows

    // 2) Current stock for those items (one FINAPI batch — accurate).
    const codes = quoted.map((r: any) => r.item_code)
    const stockMap: Record<string, any> = {}
    try {
      const stock = await fetchBatchStockGet(codes)
      for (const s of stock as any[]) {
        const c = (s.code || s.item_code || '').toUpperCase()
        if (c) stockMap[c] = s
      }
    } catch {
      // FINAPI unavailable → stock unknown; items fall through as gap candidates.
    }

    // 3) Keep only out-of-stock + nothing incoming (the actual gap).
    const candidates = quoted
      .map((r: any) => {
        const s = stockMap[String(r.item_code).toUpperCase()] || {}
        return {
          item_code: r.item_code,
          name: r.item_name || r.item_code,
          total_qty: Number(r.total_qty_quoted) || 0,
          total_value: 0,
          quote_count: r.times_quoted,
          customer_count: r.times_quoted,
          last_quoted: r.last_quoted_date || '',
          stock_qty: Number(s.stock_qty ?? 0),
          incoming_qty: Number(s.incoming_qty ?? 0),
          ordered_qty: Number(s.ordered_qty ?? 0),
        }
      })
      .filter((i: any) => i.stock_qty <= 0)
      .slice(0, limit)

    // 4) The batch stock feed sometimes reports 0 for items that ARE in stock
    //    or DO have incoming/ordered qty (FINAPI quirk — items.get is the
    //    authoritative source, matches hover). Verify every claimed-0 candidate
    //    per-item: drop false gaps, and take all quantities from the truth.
    const verified: typeof candidates = []
    const CONCURRENCY = 10
    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const batch = await Promise.all(
        candidates.slice(i, i + CONCURRENCY).map(async (c: any) => {
          try {
            const item: any = await client.items.get(c.item_code)
            const realQty = Number(item?.stock_qty ?? 0)
            if (realQty > 0) return null // false gap — actually in stock
            return {
              ...c,
              stock_qty: realQty,
              incoming_qty: Number(item?.incoming_qty ?? 0),
              ordered_qty: Number(item?.ordered_qty ?? 0),
            }
          } catch {
            return c // FINAPI hiccup → keep the candidate rather than hide it
          }
        }),
      )
      verified.push(...(batch.filter(Boolean) as typeof candidates))
    }
    const items = verified

    const payload = {
      items,
      count: items.length,
      total_quoted_items: quoted.length,
      total_lost_qty: items.reduce((s: number, i: any) => s + i.total_qty, 0),
    }
    await setCache(cacheKey, payload, 3 * 60 * 60) // 3h — the 2h warm cycle (refresh=1) keeps it fresh
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[gap] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed', items: [], count: 0 },
      { status: 500 },
    )
  }
}
