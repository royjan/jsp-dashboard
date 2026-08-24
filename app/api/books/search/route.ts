import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getLiveYear, searchBooks } from '@/lib/services/books-service'
import { booksError } from '@/lib/books/scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const url = new URL(request.url)
    const year = Number(url.searchParams.get('year')) || await getLiveYear()
    const results = await searchBooks(url.searchParams.get('q') ?? '', year)
    return NextResponse.json({ results })
  } catch (e) {
    return NextResponse.json(booksError(e, { results: [] }), { status: 500 })
  }
}
