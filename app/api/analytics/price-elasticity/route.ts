export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getPriceElasticity } from '@/lib/services/price-elasticity'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const topN = Number(searchParams.get('top_n')) || 50
    const minMonths = Number(searchParams.get('min_months')) || 6
    const report = await getPriceElasticity(topN, minMonths)
    return NextResponse.json(report)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}
