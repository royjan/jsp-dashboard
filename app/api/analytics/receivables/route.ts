export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { getCached, setCache } from '@/lib/redis-client'
import { fetchAllCustomers, fetchCustomerAging } from '@/lib/finansit-client'

/**
 * Accounts-receivable (AR) overview.
 *
 * Open balances come LIVE from the Finansit SDK: the customer list already carries
 * a `balance` per customer, so one paginated sweep gives every debtor. For the top N
 * displayed debtors we additionally pull real per-bucket aging via getAging(code).
 * Falls back to the synced dashboard.customer_stats table if the SDK is unavailable.
 */

interface ReceivableCustomer {
  code: string
  name: string
  balance: number
  open_count: number
  aging: { current: number; days_30: number; days_60: number; days_90: number; over_90: number }
}

function emptyAging() {
  return { current: 0, days_30: 0, days_60: 0, days_90: 0, over_90: 0 }
}

function sumTotals(customers: ReceivableCustomer[]) {
  return customers.reduce(
    (t, c) => {
      t.total_balance += c.balance
      t.total_current += c.aging.current
      t.total_30 += c.aging.days_30
      t.total_60 += c.aging.days_60
      t.total_90 += c.aging.days_90
      t.total_over_90 += c.aging.over_90
      return t
    },
    { total_balance: 0, total_current: 0, total_30: 0, total_60: 0, total_90: 0, total_over_90: 0 },
  )
}

async function fromLiveSdk(limit: number) {
  const all = await fetchAllCustomers()
  const debtors = all
    .map((c: any) => ({
      code: c.code || c.customer_code || '',
      name: c.name || c.customer_name || c.code || '',
      balance: Number(c.balance ?? c.total ?? 0) || 0,
    }))
    .filter((c) => c.code && c.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit)

  if (debtors.length === 0) return null

  // Real aging buckets for the displayed debtors (bounded, batched).
  const customers: ReceivableCustomer[] = []
  for (let i = 0; i < debtors.length; i += 10) {
    const batch = debtors.slice(i, i + 10)
    const aged = await Promise.all(
      batch.map(async (d) => {
        const a = await fetchCustomerAging(d.code).catch(() => null)
        const aging = a
          ? {
              current: Number(a.current ?? 0) || 0,
              days_30: Number(a['1_30'] ?? a.days_30 ?? 0) || 0,
              days_60: Number(a['31_60'] ?? a.days_60 ?? 0) || 0,
              days_90: Number(a['61_90'] ?? a.days_90 ?? 0) || 0,
              over_90: Number(a['90_plus'] ?? a.over_90 ?? 0) || 0,
            }
          : { ...emptyAging(), current: d.balance } // unknown split → show as current
        return { ...d, open_count: 0, aging }
      }),
    )
    customers.push(...aged)
  }
  return { customers, totals: sumTotals(customers), aging_basis: 'finapi_live' as const }
}

async function fromCustomerStats(limit: number) {
  const res = await query(
    `SELECT customer_code, customer_name,
            open_balance::numeric AS open_balance, open_count, last_invoice
     FROM dashboard.customer_stats
     WHERE year = (SELECT MAX(year) FROM dashboard.customer_stats)
       AND open_balance::numeric > 0
     ORDER BY open_balance::numeric DESC
     LIMIT $1`,
    [limit],
  )
  const now = Date.now()
  const customers: ReceivableCustomer[] = res.rows.map((r: any) => {
    const bal = Number(r.open_balance) || 0
    const aging = emptyAging()
    const li = r.last_invoice ? new Date(r.last_invoice) : null
    const days = li && !isNaN(li.getTime()) ? Math.floor((now - li.getTime()) / 86_400_000) : 999
    if (days < 30) aging.current = bal
    else if (days < 60) aging.days_30 = bal
    else if (days < 90) aging.days_60 = bal
    else if (days < 120) aging.days_90 = bal
    else aging.over_90 = bal
    return { code: r.customer_code, name: r.customer_name || r.customer_code, balance: bal, open_count: Number(r.open_count) || 0, aging }
  })
  return { customers, totals: sumTotals(customers), aging_basis: 'last_invoice_approx' as const }
}

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 500)

    const cacheKey = `analytics:receivables:v2:${limit}`
    const cached = await getCached<any>(cacheKey)
    if (cached) return NextResponse.json(cached)

    // Prefer live SDK; fall back to the synced table if it's empty/unavailable.
    let payload: { customers: ReceivableCustomer[]; totals: any; aging_basis: string } | null = null
    try {
      payload = await fromLiveSdk(limit)
    } catch (e) {
      console.warn('[receivables] live SDK failed, falling back to customer_stats:', e instanceof Error ? e.message : e)
    }
    if (!payload || payload.customers.length === 0) {
      payload = await fromCustomerStats(limit)
    }

    await setCache(cacheKey, payload, 60 * 60) // 1h — balances change as receipts post
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[receivables] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed', customers: [], totals: null },
      { status: 500 },
    )
  }
}
