/**
 * format.ts — THE single source of truth for how numbers, money, percentages
 * and dates are rendered in the dashboard.
 *
 * Why this file exists: before it, 65 call sites hand-rolled `toLocaleString`
 * and 39 hard-coded a `₪`, each with slightly different fraction digits and
 * grouping. Changing "how money looks" meant 65 edits. Now it means one.
 *
 * Rules of the house:
 *  - Money is ILS, grouped, no fraction digits by default (`₪1,234,567`).
 *  - Quantities/counts are grouped with `en-US` digits so they stay LTR-stable
 *    inside RTL Hebrew text.
 *  - Dates render `dd/MM/yyyy` (Israeli convention) — NOT the raw ISO string.
 *  - Anything that is an identifier (year, item code, doc number, index) must
 *    NOT be grouped. Use `formatId` / raw output for those.
 *
 * No React, no 'use client' — safe to import from server routes and client
 * components alike.
 */

import { isMoneyHidden, isDeclineHidden, MONEY_MASK } from './privacy'

// ─────────────────────────────────────────────────────────────────────────────
// Tunables — edit here to change the look everywhere.
// ─────────────────────────────────────────────────────────────────────────────

/** Locale used for currency (Hebrew — puts ₪ on the correct side). */
export const CURRENCY_LOCALE = 'he-IL'
/** Locale used for bare numbers. `en-US` keeps digits LTR-stable inside RTL text. */
export const NUMBER_LOCALE = 'en-US'
export const CURRENCY_CODE = 'ILS'

/** Default date presentation. Change this one value to restyle every date. */
export const DEFAULT_DATE_STYLE: DateStyle = 'medium'

export type DateStyle =
  /** 31/01/26 */
  | 'short'
  /** 31/01/2026 */
  | 'medium'
  /** 31/01/2026 14:05 */
  | 'datetime'
  /** 2026-01-31 — machine/sortable form, for exports and code-adjacent UI */
  | 'iso'

// ─────────────────────────────────────────────────────────────────────────────
// Money
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format as ILS currency with thousands separators (`₪1,234,567`).
 * Non-finite input renders `₪0` rather than `NaN` — dashboards should degrade
 * to a zero, never to garbage.
 *
 * Renders `₪•••` while demo mode is on (see lib/privacy.ts). Masking here
 * rather than at each call site is the whole reason this file exists: it also
 * covers the money that never passes through JSX — chart tick formatters,
 * tooltip strings, `title` attributes.
 */
export function formatCurrency(value: number | null | undefined, decimals = 0): string {
  if (isMoneyHidden()) return MONEY_MASK
  const n = Number(value)
  if (!Number.isFinite(n)) return '₪0'
  return n.toLocaleString(CURRENCY_LOCALE, {
    style: 'currency',
    currency: CURRENCY_CODE,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Compact money for stat tiles and chart axes: `₪1.2M`, `₪340K`.
 * Falls back to the full form under 1000 so small numbers stay exact.
 */
export function formatCurrencyCompact(value: number | null | undefined): string {
  if (isMoneyHidden()) return MONEY_MASK
  const n = Number(value)
  if (!Number.isFinite(n)) return '₪0'
  const abs = Math.abs(n)
  if (abs < 1_000) return formatCurrency(n)
  if (abs < 1_000_000) return `₪${trimZero(n / 1_000)}K`
  if (abs < 1_000_000_000) return `₪${trimZero(n / 1_000_000)}M`
  return `₪${trimZero(n / 1_000_000_000)}B`
}

/**
 * Money for a chart axis tick (`340K`, `1.2M`).
 *
 * Demo mode blanks the tick rather than masking it: `₪•••` repeated down every
 * gridline is noise, and the series shape is the part worth showing. The eye in
 * the top bar is what tells the viewer the numbers are hidden.
 */
export function formatCurrencyAxis(value: number, unit: 'K' | 'M' = 'K'): string {
  if (isMoneyHidden()) return ''
  return unit === 'M'
    ? `${(value / 1_000_000).toFixed(1)}M`
    : `${(value / 1_000).toFixed(0)}K`
}

/**
 * Mask the money amounts inside a block of free text.
 *
 * For prose we do not compose — LLM-written briefs, ABC insights and action
 * playbooks arrive from the server as finished Hebrew/English sentences with
 * `₪70,457` already baked in, so there is no call site to intercept. Everything
 * that is not money (counts, percentages, dates) is left alone.
 *
 * Handles both orders (`₪70,457` and `70,457 ₪`) and the magnitude words the
 * model likes to use (`₪41 אלף`, `1.5M ₪`).
 */
// Built from parts so the two symbol orders and the range form stay readable.
// NUM refuses to end on a separator, or `₪775,900,` would eat the comma that
// belongs to the sentence.
const NUM = String.raw`\d(?:[\d,.]*\d)?`
const MAG = String.raw`(?:\s?(?:אלף|מיליון|מיליארד|[kKmMbB]))?`
const RANGE = String.raw`(?:${NUM}${MAG}\s?[-–]\s?)?`
/**
 * The report page writes `ILS` in its English copy, the rest of the app `₪` —
 * and an LLM writing Hebrew prose writes `ש״ח` after the number, in either
 * quote form (a straight " or a Hebrew gershayim ״). Without that last case a
 * generated paragraph kept its amounts visible while every tile around it was
 * masked.
 */
const SYM = String.raw`(?:₪|ILS|NIS)`
const SHEKEL_WORD = String.raw`(?:ש["״׳']?ח|שקלים|שקל)`
const MONEY_IN_TEXT = new RegExp(
  String.raw`${SYM}\s?${RANGE}${NUM}${MAG}` + '|'
  + String.raw`${RANGE}${NUM}${MAG}\s?${SYM}` + '|'
  + String.raw`${RANGE}${NUM}${MAG}\s?${SHEKEL_WORD}`,
  'g',
)

export function maskMoneyInText(text: string): string {
  if (!isMoneyHidden()) return text
  return text.replace(MONEY_IN_TEXT, MONEY_MASK)
}

// ─────────────────────────────────────────────────────────────────────────────
// Numbers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a magnitude/quantity/count with thousands separators (`1,234,567`).
 *
 * NOTE: do NOT use for years (2026), item codes, doc numbers or indices —
 * those must stay un-grouped. Use `formatId` for those.
 */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString(NUMBER_LOCALE, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Compact count for tiles and axes: `1.2M`, `340K`. */
export function formatNumberCompact(value: number | null | undefined): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs < 1_000) return formatNumber(n)
  if (abs < 1_000_000) return `${trimZero(n / 1_000)}K`
  if (abs < 1_000_000_000) return `${trimZero(n / 1_000_000)}M`
  return `${trimZero(n / 1_000_000_000)}B`
}

/**
 * Identifiers — years, item codes, document numbers, row indices.
 * Deliberately NOT grouped: `2026`, not `2,026`.
 */
export function formatId(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

/** `12.5%`. Pass an already-computed percentage (12.5), not a ratio (0.125). */
export function formatPercent(value: number | null | undefined, decimals = 1): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0%'
  return `${n.toFixed(decimals)}%`
}

/** What a masked margin renders as. Percent-shaped so column widths do not jump. */
export const PERCENT_MASK = '••%'

/**
 * A percentage that is really a money figure — gross margin above all.
 *
 * `formatPercent` is for neutral ratios (share of total, coverage, a hit rate)
 * and stays visible in demo mode. A margin is not neutral: "we make 38% on
 * this" is the single number Jan Parts would least like on a projector, and
 * masking the shekels beside it while leaving the percentage up gives the
 * viewer the multiplier for free — revenue is often visible elsewhere on the
 * same screen. Non-finite renders `—`, not `0%`: an unpriced part has no
 * margin, and a zero would read as one.
 */
export function formatMarginPercent(value: number | null | undefined, decimals = 1): string {
  if (isMoneyHidden()) return PERCENT_MASK
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(decimals)}%`
}

/**
 * `+12.5%` / `-3.0%` — for deltas, where the sign carries meaning.
 *
 * Backstop for demo mode: a negative delta renders empty, so a call site added
 * later cannot quietly put a decline back on screen. It is only a backstop —
 * the arrow and colour beside it live in the component, so hide the whole
 * cluster there (see `isDeclineHidden`) rather than relying on this.
 */
export function formatPercentDelta(value: number | null | undefined, decimals = 1): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  if (isDeclineHidden(n < 0)) return ''
  return `${n > 0 ? '+' : ''}${n.toFixed(decimals)}%`
}

/** Ratio (0.125) → `12.5%`. Use when the source is a fraction. */
export function formatRatio(value: number | null | undefined, decimals = 1): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0%'
  return `${(n * 100).toFixed(decimals)}%`
}

// ─────────────────────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a date for display. Accepts a Date, an ISO string, or the
 * `YYYY-MM-DD HH:mm:ss` shape the ERP returns.
 *
 * Replaces the `String(x).slice(0, 10)` idiom that was copy-pasted across
 * pages — that leaked raw ISO (`2026-01-31`) to Hebrew-reading users and
 * silently rendered `Invalid` slices for non-string input.
 */
export function formatDate(
  value: string | number | Date | null | undefined,
  style: DateStyle = DEFAULT_DATE_STYLE,
): string {
  const d = toDate(value)
  if (!d) return '—'

  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()

  switch (style) {
    case 'short':
      return `${dd}/${mm}/${String(yyyy).slice(-2)}`
    case 'datetime': {
      const hh = String(d.getHours()).padStart(2, '0')
      const mi = String(d.getMinutes()).padStart(2, '0')
      return `${dd}/${mm}/${yyyy} ${hh}:${mi}`
    }
    // The LOCAL calendar day, which is what a `YYYY-MM-DD` in this app always
    // means — a date the ERP recorded, a bucket key, a range boundary. Reach for
    // this rather than `toISOString().split('T')[0]`: that formats the UTC day,
    // and east of Greenwich a Date built at local midnight is still the previous
    // day in UTC, so the round trip silently subtracts one.
    case 'iso':
      return `${yyyy}-${mm}-${dd}`
    case 'medium':
    default:
      return `${dd}/${mm}/${yyyy}`
  }
}

/**
 * Relative age in Hebrew: `היום`, `לפני 3 ימים`, `לפני 2 חודשים`.
 * For "when did this customer last buy" style columns, where the exact date
 * matters less than the staleness.
 */
export function formatRelativeDate(
  value: string | number | Date | null | undefined,
  now: Date = new Date(),
): string {
  const d = toDate(value)
  if (!d) return '—'

  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (days < 0) return formatDate(d)
  if (days === 0) return 'היום'
  if (days === 1) return 'אתמול'
  if (days < 30) return `לפני ${days} ימים`

  const months = Math.floor(days / 30)
  if (months === 1) return 'לפני חודש'
  if (months < 12) return `לפני ${months} חודשים`

  const years = Math.floor(days / 365)
  return years === 1 ? 'לפני שנה' : `לפני ${years} שנים`
}

/** Parse the shapes the ERP and our APIs actually hand us. Null on garbage. */
export function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value

  if (typeof value === 'number') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }

  // `YYYY-MM-DD HH:mm:ss` (ERP) is not valid ISO in Safari — normalise the space.
  const normalised = value.trim().replace(' ', 'T')
  const d = new Date(normalised)
  return Number.isNaN(d.getTime()) ? null : d
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

/** 1.0 → "1", 1.24 → "1.2" — one decimal, but never a trailing `.0`. */
function trimZero(n: number): string {
  const rounded = Math.round(n * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

// ─────────────────────────────────────────────────────────────────────────────
// Preconfigured Intl instances (kept for callers that pass them to charts)
// ─────────────────────────────────────────────────────────────────────────────

const ILS_INTL = new Intl.NumberFormat(CURRENCY_LOCALE, {
  style: 'currency',
  currency: CURRENCY_CODE,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

/**
 * Duck-typed `Intl.NumberFormat` — callers pass it straight to charts as a
 * `.format` fn, so it has to honour demo mode too. Not the real Intl instance,
 * because that one cannot be made to lie.
 */
export const ILS_FORMAT = {
  format: (value: number) => (isMoneyHidden() ? MONEY_MASK : ILS_INTL.format(value)),
}

export const NUMBER_FORMAT = new Intl.NumberFormat('en-IL', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})
