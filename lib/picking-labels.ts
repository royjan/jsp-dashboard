/**
 * invagent's vocabulary, in Hebrew.
 *
 * The picking app stores English enums (`ready_to_ship`, `urgent`) and English
 * free-ish text for why a line could not be picked. The warehouse floor reads
 * Hebrew, and this dashboard is Hebrew everywhere else, so the raw values were
 * the only English on the page.
 *
 * Two rules hold this together:
 *
 * 1. **An unknown value is returned unchanged, never blanked and never guessed
 *    at.** These strings come from an app on a release cycle we do not control:
 *    the checked-out source offers `Out of stock / Damaged / Cannot locate /
 *    Wrong item / Other`, while the LIVE rows say `Broken / Damaged` and
 *    `Can't find` — the deployed build and this repo already disagree. A map
 *    that swallowed what it did not recognise would turn the next renamed
 *    reason into a blank cell, and a blank reads as "no reason given".
 * 2. **Reasons are matched on letters only.** `Can't find`, `Cannot locate` and
 *    a future `cant_find` are the same fact wearing different punctuation.
 *
 * Both English vocabularies are mapped, since old rows keep the words they were
 * written with.
 */

/** pick_orders.status — the complete set, from invagent's own OrderStatus enum. */
const STATUS: Record<string, string> = {
  in_progress: 'בליקוט',
  ready_to_ship: 'מוכן למשלוח',
  shipped: 'נשלח',
}

/** pick_orders.priority — invagent's OrderPriority enum. */
const PRIORITY: Record<string, string> = {
  low: 'נמוכה',
  normal: 'רגילה',
  high: 'גבוהה',
  urgent: 'דחופה',
}

/** label_lines.unavailable_reason, keyed by letters alone (see rule 2). */
const REASON: Record<string, string> = {
  cantfind: 'לא נמצא במדף',
  cannotlocate: 'לא נמצא במדף',
  brokendamaged: 'שבור / פגום',
  damaged: 'שבור / פגום',
  outofstock: 'אזל מהמלאי',
  wrongitem: 'פריט שגוי',
  other: 'אחר',
  notspecified: 'לא צוין',
}

/**
 * Sort order for the two ranked columns.
 *
 * Alphabetical is meaningless for both — it puts `high` before `low` before
 * `normal` before `urgent`, and once the cells are Hebrew it would sort by the
 * Hebrew spelling instead, which is no better. Priority follows invagent's own
 * `OrderPriority.sortOrder`; status follows the life of an order.
 * Anything unrecognised sorts last rather than colliding with `urgent` at 0.
 */
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }
const STATUS_RANK: Record<string, number> = { in_progress: 0, ready_to_ship: 1, shipped: 2 }

const key = (value: string) => value.trim().toLowerCase()
const letters = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '')

export function statusLabel(value?: string | null): string {
  if (!value) return '—'
  return STATUS[key(value)] ?? value
}

export function priorityLabel(value?: string | null): string {
  if (!value) return '—'
  return PRIORITY[key(value)] ?? value
}

export function reasonLabel(value?: string | null): string {
  if (!value) return '—'
  return REASON[letters(value)] ?? value
}

export function statusRank(value?: string | null): number {
  return STATUS_RANK[key(value ?? '')] ?? 99
}

export function priorityRank(value?: string | null): number {
  return PRIORITY_RANK[key(value ?? '')] ?? 99
}

/** The high-attention priorities, which the queue marks in red. */
export function isHotPriority(value?: string | null): boolean {
  return key(value ?? '') === 'urgent' || key(value ?? '') === 'high'
}
