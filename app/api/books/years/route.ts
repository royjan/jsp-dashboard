import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getBooksYears, getYearTotals } from '@/lib/services/books-service'
import { booksError } from '@/lib/books/scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET() {
  try {
    await initializeSecrets()
    const [years, totals] = await Promise.all([getBooksYears(), getYearTotals()])
    return NextResponse.json({ years, totals })
  } catch (e) {
    return NextResponse.json({ ...booksError(e), years: [], totals: [] }, { status: 500 })
  }
}
