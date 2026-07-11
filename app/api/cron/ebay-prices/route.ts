export const maxDuration = 300 // 5 min — iterates a bounded batch of parts × markets

import { NextResponse } from 'next/server'
import { initializeSecrets, getSecret } from '@/lib/aws-secrets'
import { getItems } from '@/lib/services/analytics-service'
import { getDb } from '@/lib/db'
import { ebayPriceCompare } from '@/lib/db/schema'
import { fetchEbayComparable } from '@/lib/ebay-browse'
import { sql } from 'drizzle-orm'

/**
 * GET /api/cron/ebay-prices?limit=40
 *
 * Rate-limit-aware warm job for the eBay price comparison. Refreshes the
 * least-recently-checked candidate parts (never-checked first) so that, run a
 * handful of times a day, the whole catalog stays fresh on a rolling ~2-week
 * cycle while staying well under eBay's ~5k Browse calls/day.
 *
 * Cost per part ≈ EBAY_MARKETS.length calls (~10). Default 40 parts ≈ 400 calls.
 * Candidate set mirrors /ebay-recommend: in stock + price ≥ ₪1,000.
 */
const MIN_PRICE = 1000

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

    // Candidate parts (canonical, chain-collapsed) matching the ebay-reco filter.
    const items = await getItems()
    const candidates = items.filter(it => (it.stock_qty || 0) > 0 && (it.price || 0) >= MIN_PRICE)

    // Order by staleness: never-checked first, then oldest checked_at.
    const db = await getDb()
    const seen = await db
      .select({ itemCode: ebayPriceCompare.itemCode, checkedAt: ebayPriceCompare.checkedAt })
      .from(ebayPriceCompare)
    const checkedAt = new Map(seen.map(r => [r.itemCode, r.checkedAt ? new Date(r.checkedAt).getTime() : 0]))
    candidates.sort((a, b) => (checkedAt.get(a.code) ?? 0) - (checkedAt.get(b.code) ?? 0))

    const batch = candidates.slice(0, limit)
    let updated = 0, withComparable = 0, errors = 0

    for (const it of batch) {
      try {
        // Search by the canonical part number (current MPN).
        const cmp = await fetchEbayComparable(it.code)
        await db
          .insert(ebayPriceCompare)
          .values({
            itemCode: it.code,
            bestMarket: cmp.bestMarket,
            medianIls: cmp.medianIls,
            medianLocal: cmp.medianLocal != null ? String(cmp.medianLocal) : null,
            currency: cmp.currency,
            matchCount: cmp.matchCount,
            markets: cmp.markets,
            checkedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: ebayPriceCompare.itemCode,
            set: {
              bestMarket: cmp.bestMarket,
              medianIls: cmp.medianIls,
              medianLocal: cmp.medianLocal != null ? String(cmp.medianLocal) : null,
              currency: cmp.currency,
              matchCount: cmp.matchCount,
              markets: cmp.markets,
              checkedAt: new Date(),
            },
          })
        updated++
        if (cmp.bestMarket) withComparable++
      } catch (e) {
        errors++
        console.error(`[cron/ebay-prices] ${it.code} failed:`, e instanceof Error ? e.message : e)
      }
    }

    const [{ total }] = (await db
      .select({ total: sql<number>`count(*)::int` })
      .from(ebayPriceCompare)) as Array<{ total: number }>

    return NextResponse.json({
      candidates: candidates.length,
      processed: batch.length,
      updated, withComparable, errors,
      cachedTotal: total,
      coverage: `${total}/${candidates.length}`,
    })
  } catch (error) {
    console.error('[cron/ebay-prices] failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed' },
      { status: 500 },
    )
  }
}
