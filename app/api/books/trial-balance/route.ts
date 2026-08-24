import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getLiveYear, getTrialBalance } from '@/lib/services/books-service'
import { booksError, parseScope } from '@/lib/books/scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const live = await getLiveYear()
    const scope = parseScope(new URL(request.url), live)
    const includeZero = scope.extras.get('zero') === '1'
    return NextResponse.json(await getTrialBalance({ ...scope, includeZero }))
  } catch (e) {
    return NextResponse.json(booksError(e), { status: 500 })
  }
}
