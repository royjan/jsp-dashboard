export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { client } from '@/lib/finansit-client'

/**
 * GET /api/analytics/followups
 *
 * Recent quotes worth chasing: how many were raised in the window, what they
 * are worth, and the largest ones by value.
 *
 * TWO THINGS THIS DELIBERATELY NO LONGER DOES (2026-09-07).
 *
 * It no longer reports a conversion rate. It computed one as
 * `status='1' / (status='0' + status='1')` over the same window, which is not
 * what conversion means in this ERP: status '1' sits on 2,619 of the 497,374
 * format-31 documents in `dashboard.documents` (0.5%), so the ratio was pinned
 * near zero by construction. /gap rendered it as a flat "0%" beside two figures
 * that were correct, which is the believable-zero failure this codebase keeps
 * paying for. The real analytic — `getConversionAnalysis`, behind
 * /api/analytics/conversion — decides conversion by matching quotes to that
 * customer's invoices and answers 63% over 90 days. A widget cannot afford that
 * call, so it now links there instead of inventing its own number.
 *
 * And it no longer hardcodes `year: '2026'`, which it did in both searches. It
 * would have kept asking for 2026 in January and quietly returned nothing —
 * a silent empty panel rather than an error. The year now comes from the
 * window, and a window straddling New Year asks for both.
 */
export async function GET(request: Request) {
  try {
    await initializeSecrets()

    const { searchParams } = new URL(request.url)
    const daysBack = parseInt(searchParams.get('days_back') || '3', 10)

    const now = new Date()
    const dateFrom = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000)
    const dateTo = new Date(now.getTime() - 24 * 60 * 60 * 1000) // At least 1 day old

    const dateFromStr = dateFrom.toISOString().slice(0, 10)
    const dateToStr = dateTo.toISOString().slice(0, 10)

    // Btrieve is partitioned by year, so the search wants one. A 3-day window in
    // the first days of January spans two of them.
    const years = [...new Set([dateFrom.getUTCFullYear(), dateTo.getUTCFullYear()])]

    const results = await Promise.all(
      years.map(year =>
        client.documents.search({
          doc_format: '31',
          status: '0',
          date_from: dateFromStr,
          date_to: dateToStr,
          year: String(year),
          limit: 500,
        }),
      ),
    )

    const quotes = results.flatMap(r => r.documents || [])

    const openValue = quotes.reduce(
      (sum: number, q: any) => sum + (q.grand_total || q.total || 0),
      0,
    )

    const byValue = [...quotes].sort(
      (a: any, b: any) => (b.grand_total || b.total || 0) - (a.grand_total || a.total || 0),
    )

    return NextResponse.json({
      period: { date_from: dateFromStr, date_to: dateToStr, years },
      open_quotes: quotes.length,
      open_value: Math.round(openValue),
      largest_open: Math.round(byValue[0]?.grand_total || byValue[0]?.total || 0),
      // `limit: 500` per year is a cap, not a total — say so, so a busy week
      // reads as "at least 500" rather than as the whole picture.
      truncated: results.some(r => (r.documents || []).length >= 500),
      top_open: byValue.slice(0, 10).map((q: any) => ({
        doc_number: q.doc_number,
        customer_name: q.customer_name,
        customer_code: q.customer_code,
        total: q.grand_total || q.total || 0,
        date: q.doc_date,
      })),
    })
  } catch (error) {
    console.error('[followups] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}
