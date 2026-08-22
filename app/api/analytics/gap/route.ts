export const maxDuration = 600

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { fetchBatchStockGet, fetchItemsBatch } from '@/lib/finansit-client'
import { getCached, setCache } from '@/lib/redis-client'
import { getCanonicalizer, getItems, chainCodesOf } from '@/lib/services/analytics-service'

/**
 * Gap analysis — items quoted (format 31) in the last 12 months that we cannot
 * currently supply off the shelf.
 *
 * FINAPI's own /api/analytics/gap does a full server-side quote scan that
 * takes >60s and 504s. So we compute the "most-quoted" half from Neon
 * (dashboard.document_lines — fast), then check CURRENT stock for just those
 * top items via a single FINAPI batch-stock call (accurate, cheap).
 *
 * CHAIN-AWARE. Quotes are written against whatever code was current that day,
 * so both halves must fold the supersession chain or the page lies twice: one
 * part's quotes split across its codes and rank too low, and a part whose
 * SUCCESSOR is on the shelf is reported as a lost sale. Measured before this
 * fix: 9809162280 showed "stock 0" against 2 on the chain, and the #2 entry
 * 9812071480 (53 quotes) had 23 units sitting under 9812071480J.
 *
 * `exclude_incoming=1` additionally drops items with stock already on order —
 * off by default, because a part that is out TODAY is a gap today even if a
 * container is two weeks out.
 */
export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10), 500)
    const format = searchParams.get('format') || '31' // quotes
    const excludeIncoming = searchParams.get('exclude_incoming') === '1'

    const cacheKey = `analytics:gap:v6:${format}:${limit}:${excludeIncoming ? 'noinc' : 'all'}`
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

    // 1b) Fold the supersession chains BEFORE ranking, so a part quoted under
    //     two codes counts once with the sum of both. `docs` is a Set of doc
    //     keys, so unioning it also de-duplicates a quote that listed the old
    //     and the new code on separate lines.
    const canon = await getCanonicalizer()
    const byChain = new Map<string, {
      item_code: string; item_name: string; docs: Set<string>
      total_qty_quoted: number; last_quoted_date: string; alias_codes: Set<string>
    }>()
    for (const e of agg.values()) {
      const key = canon(e.item_code)
      let t = byChain.get(key)
      if (!t) {
        t = { item_code: key, item_name: '', docs: new Set(), total_qty_quoted: 0, last_quoted_date: '', alias_codes: new Set() }
        byChain.set(key, t)
      }
      for (const d of e.docs) t.docs.add(d)
      t.total_qty_quoted += e.total_qty_quoted
      if ((e.item_name || '').length > t.item_name.length) t.item_name = e.item_name
      if (e.last_quoted_date > t.last_quoted_date) t.last_quoted_date = e.last_quoted_date
      if (e.item_code !== key) t.alias_codes.add(e.item_code)
    }

    const quoted = [...byChain.values()]
      .map((e) => ({
        item_code: e.item_code,
        item_name: e.item_name,
        alias_codes: [...e.alias_codes],
        times_quoted: e.docs.size,
        total_qty_quoted: e.total_qty_quoted,
        last_quoted_date: e.last_quoted_date,
      }))
      .sort((a, b) => b.times_quoted - a.times_quoted)
      .slice(0, probe)

    // 2) Current stock for those items (one FINAPI batch — accurate). Stock has
    //    to be summed over the WHOLE chain: the shelf qty commonly sits on the
    //    successor (or on Jan's J-suffixed variant), not on the code that was
    //    quoted, and checking one code alone invents gaps that don't exist.
    const chainItems = await getItems().catch(() => [])
    const chainByCanonical = new Map(chainItems.map((it) => [it.code, it]))
    const codesFor = (canonicalCode: string, aliases: string[]): string[] => {
      const it = chainByCanonical.get(canonicalCode)
      const codes = new Set<string>(it ? chainCodesOf(it) : [canonicalCode])
      codes.add(canonicalCode)
      for (const a of aliases) codes.add(a)
      return [...codes]
    }

    const codes = quoted.flatMap((r) => codesFor(r.item_code, r.alias_codes))
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
    const sumOverChain = (
      chain: string[],
      lookup: (code: string) => any,
    ): { stock_qty: number; incoming_qty: number; ordered_qty: number; known: boolean } => {
      let stock = 0, incoming = 0, ordered = 0, known = false
      for (const c of chain) {
        const s = lookup(c.toUpperCase())
        if (!s) continue
        known = true
        stock += Number(s.stock_qty ?? 0) || 0
        incoming += Number(s.incoming_qty ?? 0) || 0
        ordered += Number(s.ordered_qty ?? 0) || 0
      }
      return { stock_qty: stock, incoming_qty: incoming, ordered_qty: ordered, known }
    }

    // 3) Keep only what we cannot supply off the shelf, chain-wide.
    const candidates = quoted
      .map((r) => {
        const chain = codesFor(r.item_code, r.alias_codes)
        const q = sumOverChain(chain, (c) => stockMap[c])
        return {
          item_code: r.item_code,
          name: r.item_name || r.item_code,
          alias_codes: r.alias_codes,
          total_qty: Number(r.total_qty_quoted) || 0,
          total_value: 0,
          quote_count: r.times_quoted,
          customer_count: r.times_quoted,
          last_quoted: r.last_quoted_date || '',
          stock_qty: q.stock_qty,
          incoming_qty: q.incoming_qty,
          ordered_qty: q.ordered_qty,
        }
      })
      .filter((i) => i.stock_qty <= 0)
      .slice(0, limit)

    // 4) The batch stock feed sometimes reports 0 for items that ARE in stock
    //    or DO have incoming/ordered qty (FINAPI quirk — the item endpoint is
    //    the authoritative source, matches hover). Verify every claimed-0
    //    candidate: drop false gaps, and take all quantities from the truth.
    //    One batch call per 100 codes instead of one lookup each — over the
    //    whole chain again, for the same reason as step 2.
    const truth = await fetchItemsBatch(
      candidates.flatMap((c) => codesFor(c.item_code, c.alias_codes)),
    )
    const items = candidates
      .map((c) => {
        const chain = codesFor(c.item_code, c.alias_codes)
        const q = sumOverChain(chain, (code) => truth.get(code))
        if (!q.known) return c // unknown to the item endpoint → keep the candidate rather than hide it
        if (q.stock_qty > 0) return null // false gap — the chain is actually in stock
        if (excludeIncoming && q.incoming_qty + q.ordered_qty > 0) return null
        return { ...c, stock_qty: q.stock_qty, incoming_qty: q.incoming_qty, ordered_qty: q.ordered_qty }
      })
      .filter(Boolean) as typeof candidates

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
