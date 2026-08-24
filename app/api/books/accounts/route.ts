import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getAccountClasses, getAccounts, getLiveYear } from '@/lib/services/books-service'
import { booksError, parseScope } from '@/lib/books/scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const live = await getLiveYear()
    const scope = parseScope(new URL(request.url), live)
    const classCode = scope.extras.get('class') || undefined
    const [page, classes] = await Promise.all([
      getAccounts({ ...scope, classCode }, live),
      getAccountClasses(scope.year),
    ])
    return NextResponse.json({ ...page, classes })
  } catch (e) {
    return NextResponse.json(booksError(e, { classes: [] }), { status: 500 })
  }
}
