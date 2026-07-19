/**
 * Live (Btrieve) document lines for the ACTIVE year, month-chunked in Redis.
 *
 * The Neon `dashboard.documents`/`document_lines` ETL is retired by decision —
 * everything current-year reads live from Btrieve via FINAPI. Bulk line scans
 * are slow (~45s per month window on FINAPI's Btrieve tier), so each calendar
 * month is fetched once and cached: closed months are effectively immutable
 * (7-day TTL), the current month refreshes every 3h — same cadence as the rest
 * of the analytics cache. Neon remains the source ONLY for years ≤ active-1
 * (frozen, complete).
 */
import { fetchDocumentLinesSlow } from '../finansit-client'
import { getCached, setCache } from '../redis-client'

export interface LiveDocLine {
  doc_format: string
  doc_num: string
  doc_date: string
  customer_code: string
  customer_name: string
  line_number: number
  item_code: string
  item_name: string
  quantity: number
  unit_price: number
}

const PAGE = 10000

/** One calendar month of one format, cached. `ym` = "YYYY-MM" (active year only). */
export async function getLiveMonthLines(format: string, ym: string): Promise<LiveDocLine[]> {
  const key = `live-lines:v1:${format}:${ym}`
  const cached = await getCached<LiveDocLine[]>(key)
  if (cached) return cached

  const [y, m] = ym.split('-').map(Number)
  const from = `${ym}-01`
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) // last day of month
  const out: LiveDocLine[] = []
  for (let offset = 0; ; offset += PAGE) {
    const res = await fetchDocumentLinesSlow({
      doc_format: format, date_from: from, date_to: to, limit: PAGE, offset,
    })
    const lines: LiveDocLine[] = res?.lines || []
    out.push(...lines)
    if (lines.length < PAGE) break
  }
  const nowYm = new Date().toISOString().slice(0, 7)
  await setCache(key, out, ym === nowYm ? 3 * 3600 : 7 * 24 * 3600)
  return out
}

/** All active-year lines of a format from `fromDate` (YYYY-MM-DD, clamped to Jan 1
 *  of the current year) through today. Sequential month fetches — first call of a
 *  cold year is slow (~45s × uncached months); meant to run behind the cache
 *  warmer, after which only the current month ever refreshes. */
export async function getLiveYearLines(format: string, fromDate: string): Promise<LiveDocLine[]> {
  const now = new Date()
  const year = now.getFullYear()
  const clampedFrom = fromDate > `${year}-01-01` ? fromDate : `${year}-01-01`
  const startYm = clampedFrom.slice(0, 7)
  const all: LiveDocLine[] = []
  for (let m = 1; m <= now.getMonth() + 1; m++) {
    const ym = `${year}-${String(m).padStart(2, '0')}`
    if (ym < startYm) continue
    all.push(...(await getLiveMonthLines(format, ym)))
  }
  return all.filter((l) => (l.doc_date || '') >= clampedFrom)
}
