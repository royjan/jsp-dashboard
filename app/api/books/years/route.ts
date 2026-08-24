import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getBooksYears, getYearTotals } from '@/lib/services/books-service'
import { booksError } from '@/lib/books/scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    // The section header calls this on every page just to draw the year picker;
    // the year-over-year totals scan every posting of every year, so they are
    // opt-in (?totals=1) and only the שנים screen asks.
    const wantTotals = new URL(request.url).searchParams.get('totals') === '1'
    const [years, totals] = await Promise.all([
      getBooksYears(),
      wantTotals ? getYearTotals() : Promise.resolve([]),
    ])
    return NextResponse.json({ years, totals })
  } catch (e) {
    return NextResponse.json({ ...booksError(e), years: [], totals: [] }, { status: 500 })
  }
}
