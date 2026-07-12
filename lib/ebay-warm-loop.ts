/**
 * In-app self-scheduling eBay price warmer — the free, no-external-cron way to
 * keep dashboard.ebay_price_compare fresh. Started once from instrumentation.ts
 * on server boot; every EBAY_WARM_INTERVAL_MIN (default 120) it:
 *   1. takes a Redis NX lock (so only one instance scans, even if scaled),
 *   2. asks eBay how much Browse budget is left today (getRateLimits),
 *   3. sizes the batch to fit under that budget (minus a safety buffer),
 *   4. warms that many least-recently-checked parts.
 *
 * Net effect: coverage climbs on its own after each deploy and refreshes on a
 * rolling cycle forever, always staying under eBay's free ~5k/day limit — no
 * button, no scheduler service, no cost.
 *
 * Disable with EBAY_WARM_DISABLED=true.
 */
import { initializeSecrets } from './aws-secrets'
import { getEbayRemaining, EBAY_MARKETS } from './ebay-browse'
import { warmEbayPrices } from './ebay-warm'
import { tryAcquireLock, setCache } from './redis-client'

const LOCK_KEY = 'ebay-warm-loop:lock'
const STATUS_KEY = 'ebay-warm:status'      // heartbeat, read by /api/cron/ebay-prices?mode=status
const heartbeat = (s: Record<string, unknown>) =>
  setCache(STATUS_KEY, { ...s, at: new Date().toISOString() }, 30 * 24 * 3600).catch(() => {})
const SAFETY_BUFFER = 300   // leave this many Browse calls/day untouched
const MAX_PER_RUN = 120     // cap one tick regardless of budget (keeps ticks short)
const FALLBACK_BATCH = 25   // used when the budget check itself fails (unknown)
const FIRST_DELAY_MS = 90_000 // let the app settle after boot before the first run

let started = false

export function startEbayWarmLoop(): void {
  if (started) return
  if (process.env.EBAY_WARM_DISABLED === 'true') {
    console.log('[ebay-warm-loop] disabled via EBAY_WARM_DISABLED')
    return
  }
  started = true
  const intervalMin = Math.max(15, Number(process.env.EBAY_WARM_INTERVAL_MIN) || 120)
  const tick = () => {
    runOnce().catch(e => {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[ebay-warm-loop] tick error:', msg)
      heartbeat({ phase: 'error', error: msg })
    })
  }
  setTimeout(tick, FIRST_DELAY_MS)
  setInterval(tick, intervalMin * 60_000)
  heartbeat({ phase: 'started', intervalMin })
  console.log(`[ebay-warm-loop] scheduled every ${intervalMin} min`)
}

async function runOnce(): Promise<void> {
  await initializeSecrets()

  // Only one instance scans at a time (lock auto-frees if a run dies).
  if (!(await tryAcquireLock(LOCK_KEY, 15 * 60))) {
    console.log('[ebay-warm-loop] lock held elsewhere — skipping this tick')
    return
  }

  // Size the batch to the live remaining Browse budget.
  const perItem = EBAY_MARKETS.length
  const remaining = await getEbayRemaining()
  let limit: number
  if (remaining == null) {
    limit = FALLBACK_BATCH // budget check failed — be conservative
  } else {
    const affordable = Math.floor((remaining - SAFETY_BUFFER) / perItem)
    if (affordable < 1) {
      console.log(`[ebay-warm-loop] low budget (${remaining} Browse calls left) — skipping`)
      return
    }
    limit = Math.min(MAX_PER_RUN, affordable)
  }

  await heartbeat({ phase: 'running', remaining, limit })
  const r = await warmEbayPrices(limit)
  await heartbeat({ phase: 'done', remaining, limit, updated: r.updated, coverage: `${r.cachedTotal}/${r.candidates}` })
  console.log(
    `[ebay-warm-loop] warmed ${r.updated}/${r.processed} ` +
    `(budget ${remaining ?? 'unknown'} → ${limit} items) · coverage ${r.cachedTotal}/${r.candidates}`,
  )
}
