/**
 * Where a number came from, and whether it can be trusted at face value.
 *
 * The recurring failure across this whole estate is a believable zero. A few of
 * the shapes it takes, all real and all measured:
 *   - toPg() cannot translate a query, the caller catches to [], a revenue card
 *     draws 0 and reads as a quiet month
 *   - get_monthly_sales caps at `limit` and the credits sort last, so a capped
 *     page silently drops 100% of the month's returns and biases the total UP
 *   - daily_sales for July 2026 is ~20% loaded and reports 196,028 against a
 *     true 703,351
 *   - /api/analytics/margin ranks a 1,000-item pool, so "best margin" means
 *     "best margin among the top sellers", which is not what it says
 *
 * None of those is an error. Every one of them renders as a confident number.
 * The fix is not more validation — it is refusing to show a bare figure when the
 * source, the coverage or the completeness is in question.
 *
 * This module is the vocabulary for saying so. It carries no UI; see
 * components/shared/FreshnessChip.tsx.
 */

/** Which tier actually answered. Ordered most to least authoritative. */
export type DataSource =
  | 'btrieve' // live ERP, the active year — authoritative
  | 'finapi' // FINAPI REST, which may itself be serving any of these
  | 'postgres' // the Neon archive — closed years, or a nightly replica
  | 'redis' // a cached copy of one of the above
  | 'snapshot' // a stored aggregate that may be stale by design
  | 'unavailable' // could not be read at all — NOT the same as "no rows"

export interface Provenance {
  source: DataSource
  /** When the underlying data was produced (ISO). Not when it was requested. */
  asOf?: string
  /** Rows the answer is built from, when a count is meaningful. */
  rows?: number
  /**
   * True when a cap was hit, so the answer is a floor rather than a total.
   * `rows === limit` is the usual tell and is almost never a coincidence.
   */
  truncated?: boolean
  /**
   * Set when the figure is computed over a deliberate subset (a ranking pool, a
   * sample). Says what the subset is, in the user's language.
   */
  scope?: string
  /** Why the source could not answer. Only meaningful with source 'unavailable'. */
  reason?: string
}

/** A cap was hit if we asked for N and got exactly N back. */
export function looksTruncated(rows: number, limit: number | undefined): boolean {
  return typeof limit === 'number' && rows >= limit
}

/**
 * Freshness bucket, used to pick the chip's colour.
 *
 * 'unknown' is deliberately its own bucket rather than defaulting to fresh —
 * not knowing how old a figure is and knowing it is current are different
 * states, and collapsing them is how a five-month-old snapshot passed for live.
 */
export type Freshness = 'live' | 'recent' | 'stale' | 'unknown'

export function freshnessOf(p: Provenance | undefined, now = Date.now()): Freshness {
  if (!p || p.source === 'unavailable') return 'unknown'
  if (!p.asOf) return p.source === 'btrieve' || p.source === 'finapi' ? 'live' : 'unknown'
  const ageMs = now - Date.parse(p.asOf)
  if (!Number.isFinite(ageMs)) return 'unknown'
  if (ageMs < 15 * 60_000) return 'live'
  if (ageMs < 24 * 3600_000) return 'recent'
  return 'stale'
}

/** Short Hebrew age, e.g. "לפני 4 דק׳". */
export function hebrewAge(iso: string | undefined, now = Date.now()): string | undefined {
  if (!iso) return undefined
  const ms = now - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return undefined
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'עכשיו'
  if (min < 60) return `לפני ${min} דק׳`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `לפני ${hours} שע׳`
  const days = Math.floor(hours / 24)
  if (days < 31) return `לפני ${days} ימים`
  const months = Math.floor(days / 30)
  return `לפני ${months} חודשים`
}

export const SOURCE_LABEL_HE: Record<DataSource, string> = {
  btrieve: 'ERP חי',
  finapi: 'FINAPI',
  postgres: 'ארכיון Postgres',
  redis: 'מטמון',
  snapshot: 'תצלום שמור',
  unavailable: 'מקור לא זמין',
}
