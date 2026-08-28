export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getOpenOrders } from '@/lib/xpart/queries'
import { getCached, setCache } from '@/lib/redis-client'
import { CACHE_TTL } from '@/lib/constants'
import type { Provenance } from '@/lib/provenance'

const CACHE_KEY = 'xpart:open-orders:v1'

/**
 * GET /api/xpart/orders — purchase orders placed and not yet received.
 *
 * Totals are grouped by currency rather than summed into one number: the orders
 * are a mix of EUR and USD and there is no rate on the order itself, so adding
 * them would invent a conversion the data does not carry.
 */
export async function GET() {
  try {
    await initializeSecrets()
    const cached = await getCached<{ orders: unknown[] }>(CACHE_KEY)
    if (cached) {
      return NextResponse.json({
        ...cached,
        provenance: { source: 'redis', scope: 'Xpart' } satisfies Provenance,
      })
    }

    const orders = await getOpenOrders()
    const byCurrency: Record<string, number> = {}
    let items = 0
    for (const o of orders) {
      items += o.total_items ?? 0
      const cur = o.currency ?? '—'
      byCurrency[cur] = (byCurrency[cur] ?? 0) + (o.total_value ?? 0)
    }

    const payload = { orders, summary: { count: orders.length, items, byCurrency } }
    await setCache(CACHE_KEY, payload, CACHE_TTL.XPART)

    return NextResponse.json({
      ...payload,
      provenance: {
        source: 'postgres',
        rows: orders.length,
        scope: 'Xpart',
        asOf: orders.map(o => o.order_date).filter(Boolean).sort().at(-1) ?? undefined,
      } satisfies Provenance,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed'
    console.warn('[xpart/orders]', message)
    return NextResponse.json({
      orders: [],
      summary: null,
      provenance: { source: 'unavailable', reason: message } satisfies Provenance,
    })
  }
}
