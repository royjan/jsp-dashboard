import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getJournalEntry, getLiveYear } from '@/lib/services/books-service'
import { booksError } from '@/lib/books/scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request,
                          { params }: { params: Promise<{ ref: string }> }) {
  try {
    await initializeSecrets()
    const { ref } = await params
    const year = Number(new URL(request.url).searchParams.get('year')) || await getLiveYear()
    return NextResponse.json(await getJournalEntry(decodeURIComponent(ref), year))
  } catch (e) {
    return NextResponse.json(booksError(e, { lines: [], vat: [] }), { status: 500 })
  }
}
