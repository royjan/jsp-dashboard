/**
 * Counterfeit-suspect detection: price-vs-cost.
 *
 * The rule is jan-portal's (`server/lib/fakeScan.mjs`, spec 2026-08-27): a
 * competitor advertising ORIGINAL parts at or below what the part costs US is
 * not selling the same part — the case that started it was 1920RW at a cost of
 * ₪346 against a competitor's ₪390.
 *
 * The portal owns the customer-facing consequence (the "היזהרו מזיופים" stamp
 * and the `fake_status` verdict store). What it does not own is the question a
 * buyer asks next — how old is that cost, which of these are worth chasing,
 * what are we selling them for — so the analysis lives here, over the same two
 * tables, and writes nothing.
 *
 * ONE ADDITION TO THE PORTAL'S RULE. The portal treats a cost as a cost. But a
 * cost dated 2024 against a 2026 competitor price compares two different years,
 * and the honest reading of "they are below our cost" is then "our cost is
 * old", not "the part is fake". `portal_item_costs` carries `cost_date`, and
 * 2755 of its 4310 rows are over 18 months old, so this module separates the
 * two rather than presenting them as one number.
 */

/** The portal's verdict states, in the same order. */
export const FAKE_STATUSES = ['none', 'suspect', 'confirmed', 'cleared'] as const
export type FakeStatus = (typeof FAKE_STATUSES)[number]

export function isFakeStatus(s: unknown): s is FakeStatus {
  return FAKE_STATUSES.includes(s as FakeStatus)
}

/**
 * Default margin over cost under which a competitor's "original" is suspect.
 * The portal's default, kept identical so both apps flag the same rows.
 */
export const DEFAULT_THRESHOLD_PCT = 10

/**
 * Age past which a cost is too old to carry a counterfeit accusation. 18 months
 * spans a full supplier price cycle plus a season, so a cost older than this
 * has plausibly moved for ordinary reasons.
 */
export const STALE_COST_DAYS = 548

export type SuspectVerdict =
  /** Priced at or under our cost + threshold, on a cost recent enough to trust. */
  | 'suspect'
  /** Would be a suspect, but the cost it is judged against is stale. */
  | 'stale_cost'
  /** An admin already ruled on it in the portal. */
  | 'confirmed'
  | 'cleared'
  /** Priced normally, or there is no basis to judge (no cost, no price). */
  | 'none'

export interface ScanInput {
  competitorPrice: number | null
  cost: number | null
  costDate: string | Date | null
  fakeStatus?: FakeStatus | null
}

/** Whole days between a cost's date and `now`; null when the date is unusable. */
export function costAgeDays(costDate: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (!costDate) return null
  const d = costDate instanceof Date ? costDate : new Date(costDate)
  const ms = d.getTime()
  if (!Number.isFinite(ms)) return null
  return Math.floor((now.getTime() - ms) / 86_400_000)
}

/** How far above cost the competitor is, as a percent. Negative = below cost. */
export function overCostPct(competitorPrice: number | null, cost: number | null): number | null {
  if (!isPositive(competitorPrice) || !isPositive(cost)) return null
  return (competitorPrice / cost - 1) * 100
}

function isPositive(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/**
 * Classify one competitor price against our cost.
 *
 * Order matters and mirrors the portal: an admin verdict ('confirmed' /
 * 'cleared') is final and is never recomputed — re-flagging a row a human has
 * already cleared is how an alert list becomes noise nobody reads.
 */
export function classifySuspect(
  input: ScanInput,
  thresholdPct: number = DEFAULT_THRESHOLD_PCT,
  now: Date = new Date(),
): SuspectVerdict {
  if (input.fakeStatus === 'confirmed' || input.fakeStatus === 'cleared') return input.fakeStatus

  const { competitorPrice, cost } = input
  // No cost is no basis for suspicion, and must not read as "priced fine".
  if (!isPositive(competitorPrice) || !isPositive(cost)) return 'none'

  const t = Math.min(100, Math.max(0, Number(thresholdPct) || 0))
  if (competitorPrice > cost * (1 + t / 100)) return 'none'

  const age = costAgeDays(input.costDate, now)
  if (age === null || age > STALE_COST_DAYS) return 'stale_cost'
  return 'suspect'
}

/** True for the verdicts that belong on a "look at this" list. */
export function isActionable(v: SuspectVerdict): boolean {
  return v === 'suspect' || v === 'confirmed'
}
