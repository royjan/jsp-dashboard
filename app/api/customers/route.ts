export const maxDuration = 120

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { client, fetchCustomerBalanceFallback, fetchCustomerAgingFallback } from '@/lib/finansit-client'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')

    if (!code) {
      return NextResponse.json({ error: 'Missing code parameter' }, { status: 400 })
    }

    // Fast header data only (each sub-second) — order/receipt/document history
    // moved to /api/customers/[code]/history (FINAPI Btrieve walks, 40-60s cold)
    // so the page header never waits on it.
    // Balance + aging come from the healthy .109 box (primary AR Btrieve files are broken).
    const [profile, balance, aging] = await Promise.all([
      client.customers.get(code),
      fetchCustomerBalanceFallback(code).catch(() => null),
      fetchCustomerAgingFallback(code, { include_documents: false }).catch(() => null),
    ])

    return NextResponse.json({
      profile,
      balance: balance?.net_balance ?? balance?.balance ?? balance?.total ?? 0,
      aging: {
        current: Number(aging?.buckets?.current?.total ?? aging?.current ?? 0) || 0,
        days_30: Number(aging?.buckets?.['1_30']?.total ?? aging?.['1_30'] ?? 0) || 0,
        days_60: Number(aging?.buckets?.['31_60']?.total ?? aging?.['31_60'] ?? 0) || 0,
        days_90: Number(aging?.buckets?.['61_90']?.total ?? aging?.['61_90'] ?? 0) || 0,
        over_90: Number(aging?.buckets?.over_90?.total ?? aging?.['90_plus'] ?? 0) || 0,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
