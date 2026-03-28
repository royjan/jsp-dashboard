export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getDeadStock } from '@/lib/services/analytics-service'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const years = Number(searchParams.get('years') || '1')
    const data = await getDeadStock(years)
    return NextResponse.json({ items: data, count: data.length, total_capital: data.reduce((s, i) => s + i.capital_tied, 0) })
  } catch (error) {
    console.error('[API /dead-stock] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
