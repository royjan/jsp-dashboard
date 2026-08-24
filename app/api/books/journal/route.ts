import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getJournal, getJournalKinds, getLiveYear } from '@/lib/services/books-service'
import { booksError, parseScope } from '@/lib/books/scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const live = await getLiveYear()
    const scope = parseScope(new URL(request.url), live)
    const kind = scope.extras.get('kind') || undefined
    const [page, kinds] = await Promise.all([
      getJournal({ ...scope, kind }),
      getJournalKinds(scope.year),
    ])
    return NextResponse.json({ ...page, kinds })
  } catch (e) {
    return NextResponse.json(booksError(e, { kinds: [] }), { status: 500 })
  }
}
