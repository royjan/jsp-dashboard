export const maxDuration = 300 // 5 min — iterates a bounded batch of parts × markets

import { NextResponse } from 'next/server'
import { initializeSecrets, getSecret } from '@/lib/aws-secrets'
import { warmEbayPrices, ebayCandidateItems } from '@/lib/ebay-warm'
import { getEbayRemaining, EBAY_MARKETS } from '@/lib/ebay-browse'
import { getCached } from '@/lib/redis-client'
import { getDb } from '@/lib/db'
import { ebayPriceCompare } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'

/**
 * GET /api/cron/ebay-prices?limit=40
 *
 * Manual/external trigger for the eBay price warm. The app also self-schedules
 * this via lib/ebay-warm-loop.ts, so this endpoint is mainly for on-demand runs.
 * Refreshes the least-recently-checked candidate parts; cost ≈ limit × ~10 calls.
 */
export async function GET(request: Request) {
  try {
    await initializeSecrets()

    // Optional shared-secret gate (only enforced if CRON_SECRET is configured).
    const secret = getSecret('CRON_SECRET')
    if (secret) {
      const auth = request.headers.get('authorization') || ''
      if (auth !== `Bearer ${secret}`) {
        return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      }
    }

    const { searchParams } = new URL(request.url)

    // ?mode=status — coverage, live eBay budget, and the auto-loop heartbeat.
    if (searchParams.get('mode') === 'status') {
      const db = await getDb()
      const [{ total, priced, oldest, newest }] = (await db
        .select({
          total: sql<number>`count(*)::int`,
          priced: sql<number>`count(median_ils)::int`,
          oldest: sql<string>`min(checked_at)`,
          newest: sql<string>`max(checked_at)`,
        })
        .from(ebayPriceCompare)) as Array<{ total: number; priced: number; oldest: string; newest: string }>
      const [candidates, remaining, heartbeat] = await Promise.all([
        ebayCandidateItems().then(c => c.length).catch(() => null),
        getEbayRemaining(),
        getCached('ebay-warm:status'),
      ])
      return NextResponse.json({
        coverage: candidates != null ? `${total}/${candidates}` : `${total}/?`,
        priced, candidates, oldestChecked: oldest, newestChecked: newest,
        ebayBudget: remaining == null ? 'unknown' : { remaining, perItem: EBAY_MARKETS.length, itemsAffordable: Math.floor(remaining / EBAY_MARKETS.length) },
        autoLoop: heartbeat ?? 'no heartbeat yet (loop not started or failed to import)',
      })
    }

    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 40))
    const r = await warmEbayPrices(limit)
    return NextResponse.json({ ...r, coverage: `${r.cachedTotal}/${r.candidates}` })
  } catch (error) {
    console.error('[cron/ebay-prices] failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed' },
      { status: 500 },
    )
  }
}
