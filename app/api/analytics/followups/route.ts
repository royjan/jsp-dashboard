export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { client } from '@/lib/finansit-client'

/**
 * GET /api/analytics/followups
 *
 * Computes quote follow-up analytics:
 * - How many open quotes are from ~48h ago (candidates for follow-up)
 * - How many of those have items in stock (actionable)
 * - Conversion rate of quotes overall
 *
 * This is a read-only analytics endpoint for the dashboard widget.
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

    // Get open quotes (status=0) in the window
    const openQuotesResult = await client.documents.search({
      doc_format: '31',
      status: '0',
      date_from: dateFromStr,
      date_to: dateToStr,
      year: '2026',
      limit: 500,
    })

    const openQuotes = openQuotesResult.documents || []

    // Get converted quotes (status=1) in the same window for conversion rate
    const convertedQuotesResult = await client.documents.search({
      doc_format: '31',
      status: '1',
      date_from: dateFromStr,
      date_to: dateToStr,
      year: '2026',
      limit: 500,
    })

    const convertedQuotes = convertedQuotesResult.documents || []

    const totalQuotes = openQuotes.length + convertedQuotes.length
    const conversionRate = totalQuotes > 0
      ? Math.round((convertedQuotes.length / totalQuotes) * 100)
      : 0

    // Calculate total value of open quotes
    const openValue = openQuotes.reduce(
      (sum: number, q: any) => sum + (q.grand_total || q.total || 0),
      0
    )

    const convertedValue = convertedQuotes.reduce(
      (sum: number, q: any) => sum + (q.grand_total || q.total || 0),
      0
    )

    return NextResponse.json({
      period: { date_from: dateFromStr, date_to: dateToStr },
      open_quotes: openQuotes.length,
      converted_quotes: convertedQuotes.length,
      total_quotes: totalQuotes,
      conversion_rate: conversionRate,
      open_value: Math.round(openValue),
      converted_value: Math.round(convertedValue),
      // Top open quotes by value (for display)
      top_open: openQuotes
        .sort((a: any, b: any) => (b.grand_total || 0) - (a.grand_total || 0))
        .slice(0, 10)
        .map((q: any) => ({
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
      { status: 500 }
    )
  }
}
