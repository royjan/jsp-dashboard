export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getTopSellingItems } from '@/lib/services/analytics-service'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || '30d'
    const refresh = searchParams.get('refresh') === 'true'
    const data = await getTopSellingItems(period, refresh)
    return NextResponse.json({ data, count: data.length })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
