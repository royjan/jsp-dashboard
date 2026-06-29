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

    // Fetch all customer data in parallel
    // Balance + aging come from the healthy .109 box (primary AR Btrieve files are broken).
    const [profile, balance, aging, orders, receipts, documents] = await Promise.all([
      client.customers.get(code),
      fetchCustomerBalanceFallback(code).catch(() => null),
      fetchCustomerAgingFallback(code, { include_documents: false }).catch(() => null),
      // FINAPI ignores offset and has no total-count, so fetch up to a high cap
      // (1000 works; 5000 errors) and paginate client-side. A returned length of
      // exactly the cap means "at least this many".
      client.customers.getOrders(code, { limit: 1000, direction: 'desc' }).catch(() => null),
      client.customers.getReceipts(code, { limit: 1000, direction: 'desc' }).catch(() => null),
      client.customers.getDocuments(code, { limit: 1000, direction: 'desc' }).catch(() => null),
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
      orders: orders?.orders || orders?.documents || orders || [],
      receipts: receipts?.receipts || receipts?.documents || receipts || [],
      documents: documents?.documents || documents || [],
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
