import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getLiveYear, getReceipts, getUpcomingCheques } from '@/lib/services/books-service'
import { booksError, parseScope } from '@/lib/books/scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const live = await getLiveYear()
    const scope = parseScope(new URL(request.url), live)
    const [page, cheques] = await Promise.all([
      getReceipts(scope, live),
      getUpcomingCheques(scope.year),
    ])
    return NextResponse.json({ ...page, upcomingCheques: cheques })
  } catch (e) {
    return NextResponse.json(booksError(e, { mix: [], monthly: [], upcomingCheques: [] }),
                             { status: 500 })
  }
}
