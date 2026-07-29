export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { getCached, setCache, tryAcquireLock } from '@/lib/redis-client'
import { fetchAllCustomers, fetchCustomerBalanceFallback, fetchCustomerAgingFallback } from '@/lib/finansit-client'

/**
 * Accounts-receivable (AR) overview.
 *
 * Open balances come LIVE from the FALLBACK box (192.168.0.109) — the primary box's
 * AR Btrieve files are broken (balance 500s, aging returns wrong residual data). We
 * read each customer's `net_balance` via getBalance, keep debtors (>0), and pull real
 * aging buckets for the displayed top N. Falls back to dashboard.customer_stats if the
 * SDK is unavailable.
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

// net_balance = debit − credit (what the customer owes). The .109 balance payload
// exposes net_balance directly; derive it if only the debit/credit pair is present.
function netBalanceOf(b: any): number {
  if (!b) return 0
  const net = b.net_balance ?? b.netBalance
  if (net != null) return Number(net) || 0
  const debit = Number(b.balance_debit ?? 0) || 0
  const credit = Number(b.balance_credit ?? 0) || 0
  if (debit || credit) return debit - credit
  return Number(b.balance ?? b.total ?? 0) || 0
}

function bucketsOf(a: any, fallbackBalance: number) {
  const bk = a?.buckets
  if (!bk) return { ...emptyAging(), current: fallbackBalance } // unknown split → current
  const t = (x: any) => Number(x?.total ?? x ?? 0) || 0
  return {
    current: t(bk.current),
    days_30: t(bk['1_30'] ?? bk.days_30),
    days_60: t(bk['31_60'] ?? bk.days_60),
    days_90: t(bk['61_90'] ?? bk.days_90),
    over_90: t(bk.over_90 ?? bk['90_plus']),
  }
}

async function mapWithConcurrency<T, R>(items: T[], conc: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += conc) {
    out.push(...(await Promise.all(items.slice(i, i + conc).map(fn))))
  }
  return out
}

async function fromLiveSdk(limit: number) {
  const all = await fetchAllCustomers()
  const candidates = all
    .map((c: any) => ({ code: c.code || c.customer_code || '', name: c.name || c.customer_name || c.code || '' }))
    .filter((c) => c.code)

  // net_balance per customer from the healthy fallback box (small payloads).
  const balances = await mapWithConcurrency(candidates, 8, async (c) => {
    const b = await fetchCustomerBalanceFallback(c.code).catch(() => null)
    return { ...c, balance: netBalanceOf(b) }
  })

  const debtors = balances
    .filter((c) => c.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit)

  if (debtors.length === 0) return null

  // Real aging buckets for the displayed debtors (also from .109).
  const customers: ReceivableCustomer[] = await mapWithConcurrency(debtors, 6, async (d) => {
    const a = await fetchCustomerAgingFallback(d.code, { include_documents: false }).catch(() => null)
    return { code: d.code, name: d.name, balance: d.balance, open_count: 0, aging: bucketsOf(a, d.balance) }
  })

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

async function computeAndCache(limit: number, cacheKey: string, staleKey: string) {
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
  await setCache(staleKey, payload, 7 * 24 * 60 * 60) // week-long safety net for the SWR path
  return payload
}

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 500)
    const refresh = searchParams.get('refresh') === '1'

    const cacheKey = `analytics:receivables:v3:${limit}`
    const staleKey = `${cacheKey}:stale`

    if (!refresh) {
      const cached = await getCached<any>(cacheKey)
      if (cached) return NextResponse.json(cached)

      // Cold path costs ~3.5 minutes: it pulls a live balance for every
      // customer. Never make a user wait for that — serve the last known
      // payload immediately and recompute in the background. The lock stops
      // concurrent viewers from each kicking off their own recompute.
      const stale = await getCached<any>(staleKey)
      if (stale) {
        if (await tryAcquireLock(`${cacheKey}:lock`, 10 * 60)) {
          void computeAndCache(limit, cacheKey, staleKey).catch((e) =>
            console.error('[receivables] background refresh failed:', e),
          )
        }
        return NextResponse.json({ ...stale, stale: true })
      }
    }

    const payload = await computeAndCache(limit, cacheKey, staleKey)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[receivables] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed', customers: [], totals: null },
      { status: 500 },
    )
  }
}
