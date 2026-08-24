import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getLiveYear, getReceipt } from '@/lib/services/books-service'
import { booksError } from '@/lib/books/scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request,
                          { params }: { params: Promise<{ number: string }> }) {
  try {
    await initializeSecrets()
    const { number } = await params
    const year = Number(new URL(request.url).searchParams.get('year')) || await getLiveYear()
    return NextResponse.json(await getReceipt(number, year))
  } catch (e) {
    return NextResponse.json(booksError(e, { receipt: null, lines: [], posted: [] }),
                             { status: 500 })
  }
}
