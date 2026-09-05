/**
 * values.ts — turning what the ERP actually returns into something sortable.
 *
 * `compareValues` in sort.ts already handles ISO dates and numeric strings. It
 * cannot handle the two shapes these apps display instead, because both are
 * RENDERED text and neither sorts as itself:
 *
 *   'dd/mm/yyyy'  sorts by DAY OF MONTH   — 04/09 before 30/01
 *   '4m 12s'      sorts below '10s'       — because '1' < '4'
 *
 * The rule the library already states is "sort and export the raw value, never
 * the rendered string". These are the two converters that make obeying it a
 * one-liner in a column definition:
 *
 *   { key: 'date', cell: r => r.dateText, sortValue: r => dmyToIso(r.dateText) }
 */

const DMY_RE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/

/**
 * 'dd/mm/yyyy' → 'yyyy-mm-dd', which compareValues then reads chronologically.
 * Returns null for anything that is not that shape, and null sorts LAST rather
 * than pretending to be the epoch.
 */
export function dmyToIso(s: string | null | undefined): string | null {
  if (!s) return null
  const m = DMY_RE.exec(s.trim())
  if (!m) return null
  const [, d, mo, y] = m
  const day = Number(d), month = Number(mo)
  // A real date, not just four digits in the right places: 31/02 is a parse
  // failure to report, not a value to sort somewhere arbitrary.
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const DUR_RE = /(\d+(?:\.\d+)?)\s*([hms])/gi

/**
 * '4m 12s' / '1h 3m' / '48s' → seconds. Returns null when nothing parses, so a
 * blank duration sorts last instead of tying with a genuine zero.
 */
export function durationToSeconds(s: string | null | undefined): number | null {
  if (!s) return null
  let total = 0
  let matched = false
  DUR_RE.lastIndex = 0
  for (let m = DUR_RE.exec(s); m; m = DUR_RE.exec(s)) {
    matched = true
    const n = Number(m[1])
    total += m[2].toLowerCase() === 'h' ? n * 3600 : m[2].toLowerCase() === 'm' ? n * 60 : n
  }
  return matched ? total : null
}

/**
 * An item NAME that is really somebody's part number.
 *
 * The ERP has rows where the name field holds a code: item 1623180680 is named
 * '0857428661', and 1574JK is named '0829193289    #####'. A screen that prints
 * that as a name shows a customer a number for a different part.
 *
 * A `/^\d+$/` test misses the second shape — that is why this exists as a
 * function rather than a regex at each call site. The dashboard exports the
 * same predicate from lib/services/analytics-service.ts; this is the copy the
 * shared components use so <ItemName> has no path back into one app.
 */
export function looksLikeCodeNotName(name: string | null | undefined): boolean {
  if (!name) return false
  const s = name.trim()
  if (s === '') return false
  // Digits, whitespace and the ##### padding the ERP appends — and nothing else.
  // Requires at least five digits so a genuine short name ('W 5') is not caught.
  if (!/^[\d\s#]+$/.test(s)) return false
  return (s.match(/\d/g) ?? []).length >= 5
}

/** What a stock figure means. `null` is UNKNOWN and is not zero. */
export type StockState = 'in' | 'out' | 'unknown'

/**
 * The one place the three-way decision is made.
 *
 * Diego rendered `במלאי אין במלאי` because a label and a value were pasted
 * together, and `₪0.00` as a price because a missing number was formatted like
 * a real one. Both are the same mistake: treating absent as a value. Anything
 * that is not a finite number is UNKNOWN here — never 'out'.
 */
export function stockState(qty: number | null | undefined): StockState {
  if (qty === null || qty === undefined || !Number.isFinite(qty)) return 'unknown'
  return qty > 0 ? 'in' : 'out'
}
