import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getBooksOverview, getLiveYear } from '@/lib/services/books-service'
import { booksError, parseScope } from '@/lib/books/scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const live = await getLiveYear()
    const scope = parseScope(new URL(request.url), live)
    return NextResponse.json({ scope, ...(await getBooksOverview(scope, live)) })
  } catch (e) {
    return NextResponse.json(booksError(e, { monthly: [], topAccounts: [] }), { status: 500 })
  }
}
