import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getBankAccounts, getCashTable, getLiveYear } from '@/lib/services/books-service'
import { booksError, parseScope } from '@/lib/books/scope'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** The four bank-side lists (דפי בנק, שיקים, תשלומים, הוראות תשלום) share one
 *  shape, so they share one route: ?table=banks|cheques|payments|orders. */
const TABLES = {
  banks: 'bank_lines', cheques: 'cheques',
  payments: 'bank_payments', orders: 'payment_orders',
} as const

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const live = await getLiveYear()
    const url = new URL(request.url)
    const scope = parseScope(url, live)
    const key = (url.searchParams.get('table') ?? 'banks') as keyof typeof TABLES
    const table = TABLES[key]
    if (!table) return NextResponse.json({ error: 'unknown table', rows: [] }, { status: 400 })
    const bankAccount = url.searchParams.get('account') || undefined
    const [page, accounts] = await Promise.all([
      getCashTable(table, { ...scope, bankAccount }),
      getBankAccounts(scope.year),
    ])
    return NextResponse.json({ ...page, table: key, bankAccounts: accounts })
  } catch (e) {
    return NextResponse.json(booksError(e, { bankAccounts: [] }), { status: 500 })
  }
}
