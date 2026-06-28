import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getPartsBotMetrics } from '@/lib/chat-admin/search-analytics'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/admin/search-analytics?view=partsbot&days=&portal=&gate=
 * v1 implements the `partsbot` view used by the parts-analytics dashboard.
 */
export async function GET(request: NextRequest) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view') || 'partsbot'
    const daysRaw = parseInt(searchParams.get('days') || '7')
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : 7

    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    const endDate = new Date()

    if (view === 'partsbot') {
      const portal = searchParams.get('portal') || undefined
      const gate = searchParams.get('gate') || undefined
      const metrics = await getPartsBotMetrics(startDate, endDate, { portal, gate })
      return NextResponse.json({ metrics, period: { days, startDate, endDate } })
    }

    return NextResponse.json({ error: `Unsupported view: ${view}` }, { status: 400 })
  } catch (error) {
    console.error('Error fetching search analytics:', error)
    return NextResponse.json({ error: 'Failed to fetch search analytics' }, { status: 500 })
  }
}
