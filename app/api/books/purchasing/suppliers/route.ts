import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getBookSuppliers, getLiveYear } from '@/lib/services/books-service'
import { booksError, parseScope } from '@/lib/books/scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const live = await getLiveYear()
    return NextResponse.json(await getBookSuppliers(parseScope(new URL(request.url), live)))
  } catch (e) {
    return NextResponse.json(booksError(e), { status: 500 })
  }
}
