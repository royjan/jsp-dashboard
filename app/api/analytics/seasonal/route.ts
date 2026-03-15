import { NextResponse } from 'next/server'
import { getSeasonalData } from '@/lib/services/analytics-service'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET() {
  try {
    await initializeSecrets()
    const data = await getSeasonalData()
    return NextResponse.json({ data, count: data.length })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
