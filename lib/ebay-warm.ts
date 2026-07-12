/**
 * Shared eBay price-warm logic — refreshes the least-recently-checked candidate
 * parts into dashboard.ebay_price_compare. Used by both the /api/cron/ebay-prices
 * route (manual/external trigger) and the in-app self-scheduling loop
 * (lib/ebay-warm-loop.ts). Rate-limit sizing lives in the callers.
 */
import { getItems } from './services/analytics-service'
import { getDb } from './db'
import { ebayPriceCompare } from './db/schema'
import { fetchEbayComparable } from './ebay-browse'
import { classifySize } from './ebay-size'

const MIN_PRICE = 1000

export type WarmResult = {
  candidates: number; processed: number; updated: number
  withComparable: number; errors: number; cachedTotal: number
}

/** Candidate parts, mirroring the /ebay-recommend filter (skip large/junk). */
export async function ebayCandidateItems() {
  const items = await getItems()
  return items.filter(it => {
    const name = (it.name || '').trim()
    if ((it.stock_qty || 0) <= 0 || (it.price || 0) < MIN_PRICE) return false
    if (!name || name.length < 2 || ['!', '.', '-', '----'].includes(name)) return false
    if (it.code.length <= 3 && /^\d+$/.test(it.code)) return false
    return classifySize(name) !== 'large'
  })
}

/** Warm up to `limit` least-recently-checked candidate parts. */
export async function warmEbayPrices(limit: number): Promise<WarmResult> {
  const candidates = await ebayCandidateItems()

  const db = await getDb()
  const seen = await db
    .select({ itemCode: ebayPriceCompare.itemCode, checkedAt: ebayPriceCompare.checkedAt })
    .from(ebayPriceCompare)
  const checkedAt = new Map(seen.map(r => [r.itemCode, r.checkedAt ? new Date(r.checkedAt).getTime() : 0]))
  // Never-checked first, then oldest checked_at.
  candidates.sort((a, b) => (checkedAt.get(a.code) ?? 0) - (checkedAt.get(b.code) ?? 0))

  const batch = candidates.slice(0, Math.max(0, limit))
  let updated = 0, withComparable = 0, errors = 0

  for (const it of batch) {
    try {
      const cmp = await fetchEbayComparable(it.code)
      const row = {
        bestMarket: cmp.bestMarket,
        medianIls: cmp.medianIls,
        medianLocal: cmp.medianLocal != null ? String(cmp.medianLocal) : null,
        currency: cmp.currency,
        matchCount: cmp.matchCount,
        oem: cmp.oem,
        bestUrl: cmp.bestUrl,
        bestTitle: cmp.bestTitle,
        markets: cmp.markets,
        checkedAt: new Date(),
      }
      await db
        .insert(ebayPriceCompare)
        .values({ itemCode: it.code, ...row })
        .onConflictDoUpdate({ target: ebayPriceCompare.itemCode, set: row })
      updated++
      if (cmp.bestMarket) withComparable++
    } catch (e) {
      errors++
      console.error(`[ebay-warm] ${it.code} failed:`, e instanceof Error ? e.message : e)
    }
  }

  const cachedTotal = (await db.$count(ebayPriceCompare)) as number
  return { candidates: candidates.length, processed: batch.length, updated, withComparable, errors, cachedTotal }
}
