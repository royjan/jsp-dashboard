export const maxDuration = 120

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import {
  fetchCustomerOrdersSlow,
  fetchCustomerReceiptsSlow,
  fetchCustomerDocumentsSlow,
} from '@/lib/finansit-client'
import { getCached, setCache } from '@/lib/redis-client'

// FINAPI ignores offset and has no total-count; it also walks the whole Btrieve
// file per call, so the cap is a latency budget, not just a page size. 250 keeps
// the worst call (~documents) reliably under FINAPI's 60s gateway limit, where
// the old limit=1000 routinely 504'd and the page showed empty tabs.
const HISTORY_LIMIT = 250
const CACHE_TTL = 30 * 60 // 30 min

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    await initializeSecrets()
    const { code } = await params
    const cacheKey = `customer:history:v1:${code}`
    const { searchParams } = new URL(request.url)

    if (searchParams.get('refresh') !== '1') {
      const cached = await getCached<any>(cacheKey)
      if (cached) return NextResponse.json(cached)
    }

    const listParams = { limit: HISTORY_LIMIT, direction: 'desc' }
    const [orders, receipts, documents] = await Promise.all([
      fetchCustomerOrdersSlow(code, listParams).catch(() => null),
      fetchCustomerReceiptsSlow(code, listParams).catch(() => null),
      fetchCustomerDocumentsSlow(code, listParams).catch(() => null),
    ])

    const payload = {
      orders: orders?.orders || orders?.documents || orders || [],
      receipts: receipts?.receipts || receipts?.documents || receipts || [],
      documents: documents?.documents || documents || [],
      // Partial results (a FINAPI call timed out) must not be cached for 30 min.
      partial: !orders || !receipts || !documents,
    }

    if (!payload.partial) await setCache(cacheKey, payload, CACHE_TTL)
    return NextResponse.json(payload)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
