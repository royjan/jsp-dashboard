export const maxDuration = 300 // 5 min — iterates a bounded batch of parts × markets

import { NextResponse } from 'next/server'
import { initializeSecrets, getSecret } from '@/lib/aws-secrets'
import { warmEbayPrices } from '@/lib/ebay-warm'

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
