/**
 * Writing `dashboard.daily_sales` without punching holes in it.
 *
 * The old shape of this — in both `/api/sync` and `/api/cron/warm-cache` — was
 * "fetch the newest 1,000 invoices, group them by day, upsert each day with
 * `excluded.revenue`". The upsert REPLACES the day's total, and a newest-N
 * window almost never lands on a midnight boundary, so the oldest day or two in
 * every window got rewritten with whatever fraction of themselves happened to be
 * inside it. Over the 2h cron cadence that walked a partial total across the
 * calendar: July 2026 ended up recorded as 316 invoices and 196,028 against a
 * true ~1,600 and ~1.15M, which is what made /brief report the year down 14%
 * when it was flat.
 *
 * The fix is to fetch a DATE RANGE instead of a count. Every day in the range is
 * then wholly inside the window, so replacing the day's total is correct — which
 * is what the upsert was always assuming.
 */
import { searchDocuments } from '@/lib/finansit-client'
import { getDb, query } from '@/lib/db'
import { dailySales } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import { DOC_FORMATS } from '@/lib/constants'

export interface DailySalesSyncResult {
  days: number
  invoices: number
  from: string
  to: string
  /** Days skipped because the fetched total was far below what is already stored. */
  rejected: { date: string; storedCount: number; fetchedCount: number }[]
}

function isoDay(d: Date): string {
  return d.toISOString().split('T')[0]
}

/**
 * Re-derive `daily_sales` for [dateFrom, dateTo] from FINAPI invoice headers.
 *
 * `year` is required when the window is in a closed fiscal year — Btrieve serves
 * the active year by default and returns nothing for an older date range.
 */
export async function syncDailySalesRange(
  dateFrom: string,
  dateTo: string,
  opts: { year?: string } = {},
): Promise<DailySalesSyncResult> {
  const params: Record<string, string> = {
    format: String(DOC_FORMATS.TAX_INVOICE),
    date_from: dateFrom,
    date_to: dateTo,
    limit: '10000',
    direction: 'desc',
  }
  if (opts.year) params.year = opts.year

  const invoices = await searchDocuments(params)
  return writeDailySalesFromInvoices(invoices, dateFrom, dateTo)
}

/**
 * Aggregate already-fetched invoice headers into `daily_sales` for a window the
 * caller guarantees was fetched in full.
 *
 * Exported so `/api/sync` can reuse it for the invoice list it already has in
 * hand (it needs the same documents for the line-item pass) without fetching
 * them twice.
 */
export async function writeDailySalesFromInvoices(
  invoices: any[],
  dateFrom: string,
  dateTo: string,
): Promise<DailySalesSyncResult> {
  const dailyMap = new Map<string, { revenue: number; count: number }>()
  for (const inv of invoices) {
    const d = inv.doc_date
    if (!d) continue
    const dateKey = d.split('T')[0]
    // A window can only be authoritative for days it actually asked for; FINAPI
    // returning something outside the range would otherwise overwrite a complete
    // day with a stray partial.
    if (dateKey < dateFrom || dateKey > dateTo) continue
    const existing = dailyMap.get(dateKey) || { revenue: 0, count: 0 }
    existing.revenue += inv.grand_total || inv.total || 0
    existing.count += 1
    dailyMap.set(dateKey, existing)
  }

  // Second line of defence. If the fetch was truncated or the box answered
  // partially, a day can still come back short — and a short day looks exactly
  // like a slow day. Refuse to overwrite a stored day with less than 60% of the
  // invoices it already has, and say which ones were refused.
  const stored = await query(
    `SELECT date, invoice_count FROM dashboard.daily_sales WHERE date >= $1 AND date <= $2`,
    [dateFrom, dateTo],
  )
  const storedCounts = new Map<string, number>(
    stored.rows.map((r: any) => [isoDay(new Date(r.date)), Number(r.invoice_count) || 0]),
  )

  const rejected: DailySalesSyncResult['rejected'] = []
  for (const [date, data] of [...dailyMap.entries()]) {
    const prev = storedCounts.get(date) || 0
    if (prev > 0 && data.count < prev * 0.6) {
      rejected.push({ date, storedCount: prev, fetchedCount: data.count })
      dailyMap.delete(date)
    }
  }
  if (rejected.length) {
    console.warn(
      `[daily-sales-sync] refused ${rejected.length} day(s) that came back short:`,
      rejected.map((r) => `${r.date} ${r.fetchedCount}<${r.storedCount}`).join(', '),
    )
  }

  const db = await getDb()
  const entries = [...dailyMap.entries()]
  for (let i = 0; i < entries.length; i += 50) {
    const batch = entries.slice(i, i + 50)
    await db.insert(dailySales)
      .values(batch.map(([date, data]) => ({
        date,
        revenue: String(data.revenue),
        invoiceCount: data.count,
      })))
      .onConflictDoUpdate({
        target: dailySales.date,
        set: { revenue: sql`excluded.revenue`, invoiceCount: sql`excluded.invoice_count` },
      })
  }

  return {
    days: entries.length,
    invoices: entries.reduce((s, [, d]) => s + d.count, 0),
    from: dateFrom,
    to: dateTo,
    rejected,
  }
}

/** The trailing window the incremental sync and the cron both refresh. */
export function recentWindow(days = 21): { dateFrom: string; dateTo: string } {
  const now = new Date()
  return {
    dateFrom: isoDay(new Date(now.getTime() - days * 86400000)),
    dateTo: isoDay(now),
  }
}
