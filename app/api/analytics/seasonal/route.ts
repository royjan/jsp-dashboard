export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getSeasonalData } from '@/lib/services/analytics-service'
import { initializeSecrets } from '@/lib/aws-secrets'

/** Clamp a date string to a sane range (10 years ago .. today) */
function clampDate(dateStr: string | undefined): string | undefined {
  if (!dateStr) return undefined
  const year = parseInt(dateStr.substring(0, 4), 10)
  const now = new Date()
  const minYear = now.getFullYear() - 10
  const maxYear = now.getFullYear() + 1
  if (year < minYear) return `${minYear}-01-01`
  if (year > maxYear) return now.toISOString().split('T')[0]
  return dateStr
}

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const dateFrom = clampDate(searchParams.get('date_from') || undefined)
    const dateTo = clampDate(searchParams.get('date_to') || undefined)
    const data = await getSeasonalData(dateFrom, dateTo)
    return NextResponse.json({ data, count: data.length })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
