export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { getCached, setCache } from '@/lib/redis-client'

/**
 * Accounts-receivable (AR) overview.
 *
 * Real open balances come from dashboard.customer_stats (open_balance/open_count,
 * populated by the warmer). True per-invoice aging buckets live in FINAPI
 * (7UPD receipts); until that's wired here, aging is APPROXIMATED by the age of
 * each customer's last invoice — the whole open balance is placed in the bucket
 * matching days-since-last-invoice. `aging_basis` flags this in the payload.
 */
export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 500)

    const cacheKey = `analytics:receivables:v1:${limit}`
    const cached = await getCached<any>(cacheKey)
    if (cached) return NextResponse.json(cached)

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
    const customers = res.rows.map((r: any) => {
      const bal = Number(r.open_balance) || 0
      const aging = { current: 0, days_30: 0, days_60: 0, days_90: 0, over_90: 0 }
      const li = r.last_invoice ? new Date(r.last_invoice) : null
      const days = li && !isNaN(li.getTime()) ? Math.floor((now - li.getTime()) / 86_400_000) : 999
      if (days < 30) aging.current = bal
      else if (days < 60) aging.days_30 = bal
      else if (days < 90) aging.days_60 = bal
      else if (days < 120) aging.days_90 = bal
      else aging.over_90 = bal
      return {
        code: r.customer_code,
        name: r.customer_name || r.customer_code,
        balance: bal,
        open_count: Number(r.open_count) || 0,
        aging,
      }
    })

    const totals = customers.reduce(
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

    const payload = { customers, totals, aging_basis: 'last_invoice_approx' }
    await setCache(cacheKey, payload, 3 * 60 * 60) // 3h
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[receivables] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed', customers: [], totals: null },
      { status: 500 },
    )
  }
}
