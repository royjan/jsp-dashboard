import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getLiveYear, getPurchasing } from '@/lib/services/books-service'
import { booksError, parseScope } from '@/lib/books/scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const live = await getLiveYear()
    const scope = parseScope(new URL(request.url), live)
    const kind = scope.extras.get('kind') || undefined
    return NextResponse.json(await getPurchasing({ ...scope, kind }, live))
  } catch (e) {
    return NextResponse.json(booksError(e, { byKind: [], monthly: [] }), { status: 500 })
  }
}
