export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getDemandAnalysis } from '@/lib/services/analytics-service'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('date_from') || undefined
    const dateTo = searchParams.get('date_to') || undefined
    const data = await getDemandAnalysis(dateFrom, dateTo)
    return NextResponse.json({ items: data, count: data.length })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
