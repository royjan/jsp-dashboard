export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { listPriceLists } from '@/lib/xpart/queries'
import { getCached, setCache } from '@/lib/redis-client'
import { CACHE_TTL } from '@/lib/constants'
import type { Provenance } from '@/lib/provenance'

const CACHE_KEY = 'xpart:price-lists:v1'

/** GET /api/xpart/price-lists — every supplier price list Xpart holds. */
export async function GET() {
  try {
    await initializeSecrets()
    const cached = await getCached<{ lists: unknown[] }>(CACHE_KEY)
    if (cached) {
      return NextResponse.json({
        ...cached,
        provenance: { source: 'redis', rows: cached.lists.length, scope: 'Xpart' } satisfies Provenance,
      })
    }

    const lists = await listPriceLists()
    const payload = { lists }
    await setCache(CACHE_KEY, payload, CACHE_TTL.XPART)

    return NextResponse.json({
      ...payload,
      provenance: {
        source: 'postgres',
        rows: lists.length,
        scope: 'Xpart',
        asOf: lists.map(l => l.effective_date).filter(Boolean).sort().at(-1) ?? undefined,
      } satisfies Provenance,
    })
  } catch (error) {
    // Xpart is another app's database; if it is unreachable the page shows an
    // empty state, not a 500 that reads as "the dashboard is broken".
    const message = error instanceof Error ? error.message : 'Failed'
    console.warn('[xpart/price-lists]', message)
    return NextResponse.json({
      lists: [],
      provenance: { source: 'unavailable', reason: message } satisfies Provenance,
    })
  }
}
