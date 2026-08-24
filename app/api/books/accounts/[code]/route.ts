import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getLedgerCard, getLiveYear } from '@/lib/services/books-service'
import { booksError, parseScope } from '@/lib/books/scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request,
                          { params }: { params: Promise<{ code: string }> }) {
  try {
    await initializeSecrets()
    const { code } = await params
    const live = await getLiveYear()
    const scope = parseScope(new URL(request.url), live)
    return NextResponse.json({ scope, ...(await getLedgerCard(code, scope)) })
  } catch (e) {
    return NextResponse.json(booksError(e, { account: null }), { status: 500 })
  }
}
