export const maxDuration = 120

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { client } from '@/lib/finansit-client'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')

    if (!code) {
      return NextResponse.json({ error: 'Missing code parameter' }, { status: 400 })
    }

    // Fetch all customer data in parallel
    const [profile, balance, aging, orders, receipts, documents] = await Promise.all([
      client.customers.get(code),
      client.customers.getBalance(code).catch(() => null),
      client.customers.getAging(code).catch(() => null),
      // FINAPI ignores offset and has no total-count, so fetch up to a high cap
      // (1000 works; 5000 errors) and paginate client-side. A returned length of
      // exactly the cap means "at least this many".
      client.customers.getOrders(code, { limit: 1000, direction: 'desc' }).catch(() => null),
      client.customers.getReceipts(code, { limit: 1000, direction: 'desc' }).catch(() => null),
      client.customers.getDocuments(code, { limit: 1000, direction: 'desc' }).catch(() => null),
    ])

    return NextResponse.json({
      profile,
      balance: balance?.balance ?? balance?.total ?? 0,
      aging: {
        current: aging?.current ?? 0,
        days_30: aging?.['1_30'] ?? aging?.days_30 ?? 0,
        days_60: aging?.['31_60'] ?? aging?.days_60 ?? 0,
        days_90: aging?.['61_90'] ?? aging?.days_90 ?? 0,
        over_90: aging?.['90_plus'] ?? aging?.over_90 ?? 0,
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
