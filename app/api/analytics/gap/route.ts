export const maxDuration = 600

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

    const cacheKey = `analytics:gap:v5:${format}:${limit}`
    const forceRefresh = searchParams.get('refresh') === '1'
    const cached = forceRefresh ? null : await getCached<any>(cacheKey)
    if (cached) return NextResponse.json(cached)

    // 1) Most-quoted items in the last 12 months — HYBRID per the data-source
    //    doctrine: years ≤ active-1 from frozen Neon (the retired ETL's data is
    //    complete through 2025), the ACTIVE year live from Btrieve via FINAPI
    //    (month-chunked Redis cache, see lib/services/live-doc-lines.ts).
    const probe = Math.min(limit * 2, 300)
    const now = new Date()
    const from12 = new Date(now.getTime() - 365 * 86400000).toISOString().slice(0, 10)
    const activeYearStart = `${now.getFullYear()}-01-01`

    const agg = new Map<string, {
      item_code: string; item_name: string; docs: Set<string>
      total_qty_quoted: number; last_quoted_date: string
    }>()
    const bump = (code: string, name: string, docKey: string, qty: number, date: string) => {
      let e = agg.get(code)
      if (!e) {
        e = { item_code: code, item_name: name, docs: new Set(), total_qty_quoted: 0, last_quoted_date: '' }
        agg.set(code, e)
      }
      e.docs.add(docKey)
      e.total_qty_quoted += qty
      if (name && name.length > (e.item_name || '').length) e.item_name = name
      if (date > e.last_quoted_date) e.last_quoted_date = date
    }

    // Previous year(s) within the window — frozen Neon.
    const neon = await query(
      `SELECT dl.item_code, dl.item_name, dl.doc_number, dl.quantity::numeric AS qty,
              d.doc_date::text AS doc_date
       FROM dashboard.document_lines dl
       JOIN dashboard.documents d
         ON d.year=dl.year AND d.format=dl.format AND d.doc_number=dl.doc_number
       WHERE dl.format = $1
         AND length(dl.item_code) > 1
         AND d.doc_date >= $2 AND d.doc_date < $3`,
      [format, from12, activeYearStart],
    )
    for (const r of neon.rows) {
      bump(r.item_code, r.item_name || '', `n:${r.doc_number}`, Number(r.qty) || 0, r.doc_date || '')
    }

    // Active year — live Btrieve.
    const { getLiveYearLines } = await import('@/lib/services/live-doc-lines')
    const liveLines = await getLiveYearLines(format, activeYearStart)
    for (const l of liveLines) {
      const code = (l.item_code || '').trim()
      if (code.length <= 1) continue
      bump(code, l.item_name || '', `l:${l.doc_num}`, Number(l.quantity) || 0, l.doc_date || '')
    }

    const quoted = [...agg.values()]
      .map((e) => ({
        item_code: e.item_code,
        item_name: e.item_name,
        times_quoted: e.docs.size,
        total_qty_quoted: e.total_qty_quoted,
        last_quoted_date: e.last_quoted_date,
      }))
      .sort((a, b) => b.times_quoted - a.times_quoted)
      .slice(0, probe)

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
