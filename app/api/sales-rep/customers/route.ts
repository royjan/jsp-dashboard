export const maxDuration = 120

import { NextResponse } from 'next/server'
import { getCustomerAnalytics } from '@/lib/services/analytics-service'
import { scoreAllCustomers, type CustomerInput, type HealthScore } from '@/lib/services/customer-health'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search') || ''

    const analytics = await getCustomerAnalytics()
    const customers = (analytics?.customers || []) as CustomerInput[]
    const scored = scoreAllCustomers(customers)

    // Sort by health priority: red first, then yellow, then green
    const bandOrder: Record<string, number> = { red: 0, yellow: 1, green: 2 }
    const sorted = [...scored.scores].sort((a: HealthScore, b: HealthScore) => {
      const aBand = bandOrder[a.band] ?? 3
      const bBand = bandOrder[b.band] ?? 3
      if (aBand !== bBand) return aBand - bBand
      // Within same band, sort by revenue desc
      return b.total_revenue - a.total_revenue
    })

    // Optional search filter
    const filtered = search
      ? sorted.filter(
          (c: HealthScore) =>
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            c.code.includes(search)
        )
      : sorted

    // Compute days since last order for each
    const enriched = filtered.map((c: HealthScore) => {
      const daysSinceOrder = c.last_purchase
        ? Math.floor(
            (Date.now() - new Date(c.last_purchase).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : null
      return {
        code: c.code,
        name: c.name,
        score: c.score,
        band: c.band,
        total_revenue: c.total_revenue,
        last_purchase: c.last_purchase,
        days_since_order: daysSinceOrder,
        factors: c.factors,
      }
    })

    return NextResponse.json({
      customers: enriched,
      summary: {
        total: scored.scores.length,
        green: scored.distribution.green,
        yellow: scored.distribution.yellow,
        red: scored.distribution.red,
      },
    })
  } catch (error) {
    console.error('[sales-rep/customers] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
