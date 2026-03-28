export const maxDuration = 120

import { NextResponse } from 'next/server'
import { getConversionAnalysis } from '@/lib/services/analytics-service'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const dateFrom = searchParams.get('date_from') || undefined
    const dateTo = searchParams.get('date_to') || undefined
    const data = await getConversionAnalysis(dateFrom, dateTo)
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
