/**
 * Keeping the live year of the books current, without an external cron.
 *
 * Closed fiscal years are loaded once and never move. The active year gains
 * postings all day, so this ticks every few minutes, walks the tail of the
 * ledger and VAT files on the ERP box, and merges what it finds — the same
 * work `/api/cron/books-refresh` does by hand.
 *
 * Same self-scheduling pattern as the eBay warmer and the morning brief:
 * started once from instrumentation.ts in production, with a Redis NX lock so
 * two app instances never refresh at the same time (the ERP's Btrieve share
 * does not enjoy company).
 *
 * Kill switch: BOOKS_REFRESH_DISABLED=true.
 */

import { setCache, tryAcquireLock } from './redis-client'

const TICK_MIN = Number(process.env.BOOKS_REFRESH_MINUTES || 10)
const FIRST_DELAY_MS = 90_000
const TAIL_RECORDS = Number(process.env.BOOKS_REFRESH_TAIL || 4_000)
const LOCK_KEY = 'books:refresh:lock'
const STATUS_KEY = 'books:refresh:status'

const heartbeat = (state: Record<string, unknown>) =>
  setCache(STATUS_KEY, { ...state, at: new Date().toISOString() }, 30 * 24 * 3600)
    .catch(() => {})

async function tick() {
  if (process.env.BOOKS_REFRESH_DISABLED === 'true') return
  // The lock is a lease slightly longer than the work, so a crashed instance
  // cannot wedge the loop for good.
  if (!(await tryAcquireLock(LOCK_KEY, 8 * 60))) return

  const started = Date.now()
  try {
    const { getLiveYear } = await import('./services/books-service')
    const { refreshLiveYear } = await import('./books/load')
    const year = await getLiveYear()
    const merged = await refreshLiveYear(year, TAIL_RECORDS)
    const seconds = Math.round((Date.now() - started) / 1000)
    console.log(`[books-refresh] j${year} merged in ${seconds}s`,
                JSON.stringify(merged))
    await heartbeat({ ok: true, year, merged, seconds })
  } catch (e) {
    // A refresh failure is not fatal: the books stay as they were, the year's
    // watermark stops advancing, and the UI banners that they are stale.
    console.error('[books-refresh] failed:', e instanceof Error ? e.message : e)
    await heartbeat({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}

export function startBooksRefreshLoop() {
  if (process.env.BOOKS_REFRESH_DISABLED === 'true') {
    console.log('[books-refresh] disabled by env')
    return
  }
  setTimeout(() => {
    void tick()
    setInterval(() => void tick(), TICK_MIN * 60_000)
  }, FIRST_DELAY_MS)
  console.log(`[books-refresh] loop armed — every ${TICK_MIN} min, tail ${TAIL_RECORDS}`)
}
