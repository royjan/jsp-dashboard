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

/** All active-year lines of a format from `fromDate` (YYYY-MM-DD, clamped to Jan 1
 *  of the current year) through today.
 *
 *  ONE call for the whole year: FINAPI's date filter costs a full 7IVL scan
 *  regardless of window size (no date index), so chunking buys nothing —
 *  a single ~45-90s scan (the endpoint is timeout-exempted server-side) is
 *  the cheapest shape. Cached 3h; the cache warmer absorbs the refresh. */
export async function getLiveYearLines(
  format: string,
  fromDate: string,
  opts?: { forceRefresh?: boolean }
): Promise<LiveDocLine[]> {
  const year = new Date().getFullYear()
  const clampedFrom = fromDate > `${year}-01-01` ? fromDate : `${year}-01-01`

  const key = `live-lines:v2:${format}:${year}`
  // forceRefresh skips the read so a warm pass resets the TTL instead of
  // riding the old one down (see warm-cache route on why hit-path warming fails).
  let all = opts?.forceRefresh ? null : await getCached<LiveDocLine[]>(key)
  if (!all) {
    all = []
    for (let offset = 0; ; offset += PAGE) {
      const res = await fetchDocumentLinesSlow({
        doc_format: format, date_from: `${year}-01-01`, limit: PAGE, offset,
      })
      const lines: LiveDocLine[] = res?.lines || []
      all.push(...lines)
      if (lines.length < PAGE) break
    }
    await setCache(key, all, 3 * 3600)
  }
  return all.filter((l) => (l.doc_date || '') >= clampedFrom)
}
