/**
 * Demand, kept in Postgres instead of re-derived from FINAPI on every request.
 *
 * WHY THIS EXISTS. `getDemandAnalysis` used to answer entirely from a live walk
 * of the quote feed, and that walk has a hard ceiling that has nothing to do
 * with the question being asked: `fetchDocumentDetailsByNumber` only serves a
 * set in ONE call when the set's doc_number span is <= 2000, and falls back to
 * per-document reads otherwise. So a year-to-date range could not be answered
 * more completely than a two-week one — it was answered LESS completely, because
 * widening the range pushed it off the fast path. The honest workaround was to
 * read only the newest 2000-number window and log that the result is a floor.
 *
 * It does not have to be a floor. `dashboard.document_lines` already holds
 * 300,016 format-31 (quote) lines going back to 2024 — the demand data was in
 * Postgres the whole time, unused. This module aggregates it once into a table
 * shaped for the question, and keeps the recent tail current from FINAPI.
 *
 * TWO THINGS ABOUT THE ARCHIVE THAT WILL BITE IF IGNORED:
 *
 * 1. DUPLICATION. A document still open when Btrieve rolls over is archived
 *    again from the next fiscal year's database, so it exists under two `year`
 *    values. Format-31 lines: 300,016 rows for 223,736 distinct
 *    (doc_number, line). Aggregating without deduping inflates every count by
 *    ~34%. `DISTINCT ON (doc_number, line) ... ORDER BY ..., year DESC` is not
 *    optional here.
 *
 * 2. QUANTITY IS OFTEN ZERO. 138,384 of 300,016 quote lines carry quantity 0 —
 *    and invoices show the same pattern, so this is how the ERP writes lines,
 *    not corruption. The live path has always read it as `line.quantity || 1`,
 *    counting such a line as one unit. `GREATEST(COALESCE(quantity,0),1)`
 *    reproduces that exactly, so the two sources stay comparable. Changing it
 *    would silently redefine the "by quantity" chart.
 */

import { query } from '../db'
import { searchDocuments, fetchDocumentDetailsByNumber } from '../finansit-client'

const QUOTE_FORMAT = '31'

export interface DemandTotals {
  count: number
  qty: number
}

/** Idempotent. Cheap enough to call on any path that touches the table. */
export async function ensureDemandTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS dashboard.demand_daily (
      doc_date  date    NOT NULL,
      item_code text    NOT NULL,
      requests  integer NOT NULL,
      qty       numeric NOT NULL,
      PRIMARY KEY (doc_date, item_code)
    )
  `)
}

/**
 * Rebuild the archive-covered part of the table from `document_lines`.
 *
 * Idempotent by construction: it recomputes whole days and replaces them, so
 * re-running after the document loader advances simply corrects those days.
 * Returns the number of (day, item) rows written.
 */
export async function backfillFromArchive(): Promise<{ rows: number; from: string | null; to: string | null }> {
  await ensureDemandTable()
  const res = await query(`
    WITH deduped AS (
      SELECT DISTINCT ON (doc_number, line)
             doc_number, line, item_code, quantity, doc_date
      FROM dashboard.document_lines
      WHERE format = $1
        AND doc_date IS NOT NULL
        AND item_code IS NOT NULL
        AND length(item_code) > 1
      ORDER BY doc_number, line, year DESC
    ),
    agg AS (
      SELECT doc_date,
             item_code,
             COUNT(*)::int                             AS requests,
             SUM(GREATEST(COALESCE(quantity, 0), 1))   AS qty
      FROM deduped
      GROUP BY doc_date, item_code
    ),
    upserted AS (
      INSERT INTO dashboard.demand_daily (doc_date, item_code, requests, qty)
      SELECT doc_date, item_code, requests, qty FROM agg
      ON CONFLICT (doc_date, item_code)
      DO UPDATE SET requests = EXCLUDED.requests, qty = EXCLUDED.qty
      RETURNING doc_date
    )
    SELECT COUNT(*)::int AS rows, MIN(doc_date)::text AS from, MAX(doc_date)::text AS to FROM upserted
  `, [QUOTE_FORMAT])
  const r = res.rows[0] || {}
  return { rows: r.rows ?? 0, from: r.from ?? null, to: r.to ?? null }
}

/** Newest day the table holds. Null when it is empty. */
export async function demandWatermark(): Promise<string | null> {
  await ensureDemandTable()
  const res = await query(`SELECT MAX(doc_date)::text AS hi FROM dashboard.demand_daily`)
  return res.rows[0]?.hi ?? null
}

/** Totals per raw item code over an inclusive date range. */
export async function readDemand(from: string, to: string): Promise<Map<string, DemandTotals>> {
  await ensureDemandTable()
  const res = await query(`
    SELECT item_code,
           SUM(requests)::int AS c,
           SUM(qty)           AS q
    FROM dashboard.demand_daily
    WHERE doc_date >= $1 AND doc_date <= $2
    GROUP BY item_code
  `, [from, to])
  const out = new Map<string, DemandTotals>()
  for (const row of res.rows) {
    out.set(String(row.item_code), { count: Number(row.c) || 0, qty: Number(row.q) || 0 })
  }
  return out
}

/**
 * Split doc numbers into groups the feed can serve in one call each.
 *
 * This is the constraint the old request path surrendered to. It is not a
 * ceiling on what can be known — only on how much fits in a single call — so a
 * background job can simply make several. Greedy over a sorted list: a chunk
 * closes as soon as adding the next number would push its span past the limit.
 */
export function chunkByNumberSpan(numbers: number[], span = 2000): number[][] {
  const sorted = [...numbers].sort((a, b) => a - b)
  const chunks: number[][] = []
  let current: number[] = []
  for (const n of sorted) {
    if (current.length > 0 && n - current[0] + 1 > span) {
      chunks.push(current)
      current = []
    }
    current.push(n)
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/** Every quote header in a date range, walked backwards a page at a time. */
async function listQuotes(from: string, to: string, maxPages = 40): Promise<any[]> {
  const PAGE = 1000
  const all: any[] = []
  let cursorTo = to
  for (let page = 0; page < maxPages; page++) {
    const batch = await searchDocuments({
      format: QUOTE_FORMAT,
      date_from: from,
      date_to: cursorTo,
      limit: String(PAGE),
      direction: 'desc',
    })
    all.push(...batch)
    if (batch.length < PAGE) break
    let oldest = ''
    for (const q of batch) {
      const d = String(q.doc_date || '')
      if (d && (!oldest || d < oldest)) oldest = d
    }
    if (!oldest || oldest <= from) break
    const prev = new Date(oldest + 'T00:00:00Z')
    prev.setUTCDate(prev.getUTCDate() - 1)
    const next = prev.toISOString().slice(0, 10)
    // A single day holding more than PAGE quotes would otherwise spin forever.
    if (next >= cursorTo) break
    cursorTo = next
  }
  return all
}

/**
 * Pull a date range from FINAPI into the table.
 *
 * Whole days are replaced rather than merged, so re-ingesting a range that has
 * since been edited in the ERP corrects it instead of double-counting. This is
 * for background work only — it makes as many feed calls as the range needs.
 */
export async function ingestRange(
  from: string,
  to: string,
  maxQuotes = 400,
): Promise<{ days: number; rows: number; quotes: number; through: string | null }> {
  await ensureDemandTable()

  const quotes = await listQuotes(from, to)

  /* BUDGETED IN QUOTES, AND PROCESSED OLDEST DAY FIRST.
   *
   * The feed cannot serve format 31 in one call — its changes feed carries no
   * `line_total` for quotes — so every quote here is an individual FINAPI read
   * at roughly 0.7s (measured: 40 documents in 27.6s). That is the same cost
   * that made the old demand endpoint a two-minute cold path, and it is why a
   * day-bounded ingest was the wrong shape: fourteen days is ~2,000 quotes,
   * ~23 minutes of sustained load on a box that also answers the phone system.
   * Asking for that much at once is what pushed FINAPI into 503 "Server busy".
   *
   * So: take whole days in chronological order until the budget runs out. Whole
   * days, because a partially-read day written to the table is indistinguishable
   * from a quiet one. Chronological, because that is what lets the watermark
   * advance monotonically and the next run pick up exactly where this one
   * stopped. */
  const byDay = new Map<string, number[]>()
  for (const q of quotes) {
    const n = parseInt(String(q.doc_number ?? ''), 10)
    const d = String(q.doc_date || '').slice(0, 10)
    if (!Number.isFinite(n) || !d) continue
    const list = byDay.get(d)
    if (list) list.push(n)
    else byDay.set(d, [n])
  }

  const dateOf = new Map<number, string>()
  let budget = maxQuotes
  let through: string | null = null
  for (const day of [...byDay.keys()].sort()) {
    const nums = byDay.get(day)!
    // Always take the first day even if it alone exceeds the budget, or a busy
    // day larger than one budget would block the watermark forever.
    if (budget <= 0 && dateOf.size > 0) break
    for (const n of nums) dateOf.set(n, day)
    budget -= nums.length
    through = day
  }

  const perDay = new Map<string, Map<string, DemandTotals>>()
  for (const chunk of chunkByNumberSpan([...dateOf.keys()])) {
    const details = await fetchDocumentDetailsByNumber(31, chunk.map(String))
    /* AN EMPTY ANSWER FOR A NON-EMPTY ASK IS AN UPSTREAM FAILURE, NOT "NO DEMAND".
     *
     * This is not hypothetical. The first run of this ingest asked for 2,000
     * quotes while FINAPI's primary was returning 503 "Server busy": the feed's
     * one-call path was unavailable for format 31, every per-document gap-fill
     * read threw, `fetchDocumentDetailsByNumber` swallowed each one and returned
     * [], and the ingest cheerfully concluded that twelve days contained no
     * demand — then deleted those twelve days. Aborting here is what stops a
     * transient upstream outage from being written into the table as fact. */
    if (details.length === 0 && chunk.length > 0) {
      throw new Error(
        `demand ingest aborted: FINAPI returned no detail for ${chunk.length} quotes ` +
          `(${chunk[0]}..${chunk[chunk.length - 1]}) — refusing to replace days with nothing`,
      )
    }
    for (const detail of details) {
      if (!detail?.lines) continue
      const n = parseInt(String(detail.doc_number ?? ''), 10)
      const day = dateOf.get(n)
      if (!day) continue
      let dayMap = perDay.get(day)
      if (!dayMap) { dayMap = new Map(); perDay.set(day, dayMap) }
      for (const line of detail.lines) {
        const code = line.item_code
        if (!code || String(code).length <= 1) continue
        const e = dayMap.get(code) || { count: 0, qty: 0 }
        e.count += 1
        e.qty += Number(line.quantity) || 1
        dayMap.set(code, e)
      }
    }
  }

  /* REPLACE ONLY THE DAYS WE ACTUALLY READ.
   *
   * The delete used to be driven by the quote HEADERS (`dateOf`), which is a
   * list of days that have quotes — not a list of days whose lines we managed
   * to fetch. When the fetch failed, that difference cost twelve days of good
   * archive data. Driving it from `perDay` means a day is only ever replaced by
   * something, never by nothing.
   *
   * The trade-off is deliberate and asymmetric: a day whose quotes genuinely
   * carry no usable lines keeps whatever it already had, so the table can hold a
   * stale day. That is a far cheaper failure than deleting a real one. */
  const days = [...perDay.keys()]
  if (days.length === 0) return { days: 0, rows: 0, quotes: quotes.length, through: null }

  await query(`DELETE FROM dashboard.demand_daily WHERE doc_date = ANY($1::date[])`, [days])

  let rows = 0
  const values: string[] = []
  const params: any[] = []
  for (const [day, dayMap] of perDay) {
    for (const [code, t] of dayMap) {
      params.push(day, code, t.count, t.qty)
      values.push(`($${params.length - 3}::date, $${params.length - 2}, $${params.length - 1}::int, $${params.length}::numeric)`)
      rows++
      // Postgres caps a statement at 65535 parameters; flush well before that.
      if (params.length >= 8000) {
        await query(
          `INSERT INTO dashboard.demand_daily (doc_date, item_code, requests, qty) VALUES ${values.join(',')}
           ON CONFLICT (doc_date, item_code) DO UPDATE SET requests = EXCLUDED.requests, qty = EXCLUDED.qty`,
          params,
        )
        values.length = 0
        params.length = 0
      }
    }
  }
  if (values.length > 0) {
    await query(
      `INSERT INTO dashboard.demand_daily (doc_date, item_code, requests, qty) VALUES ${values.join(',')}
       ON CONFLICT (doc_date, item_code) DO UPDATE SET requests = EXCLUDED.requests, qty = EXCLUDED.qty`,
      params,
    )
  }

  return { days: days.length, rows, quotes: dateOf.size, through }
}
