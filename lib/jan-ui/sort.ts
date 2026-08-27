/**
 * sort.ts — the one comparator the dashboard sorts by.
 *
 * Originally extracted from the Jan dashboard's old `sortable-table.tsx` so that <DataTable>,
 * <SortableTh> and any ad-hoc `.sort()` all order values identically. Getting
 * this wrong is subtle and user-visible: Hebrew names collating as raw code
 * points, "10" sorting before "9", empty cells floating to the top.
 *
 * Rules:
 *  - Blank (null / undefined / '') always sorts LAST, in both directions.
 *  - ISO-ish date strings compare chronologically, not lexically.
 *  - Numeric-looking strings compare numerically ("10" > "9").
 *  - Everything else uses Hebrew-aware collation.
 */

export type SortDir = 'asc' | 'desc'

// ISO date detection: 2024-01-31, 2024-01-31T12:00:00Z, 2024-01-31 12:00, etc.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/

const isBlank = (v: unknown): boolean => v === null || v === undefined || v === ''

/**
 * Compare two cell values. Blanks sort last — the caller must apply this
 * BEFORE flipping for direction, which `sortRows` below does for you.
 */
export function compareValues(a: unknown, b: unknown): number {
  const aNil = isBlank(a)
  const bNil = isBlank(b)
  if (aNil && bNil) return 0
  if (aNil) return 1
  if (bNil) return -1

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }

  if (typeof a === 'string' && typeof b === 'string') {
    // ISO date strings → chronological
    if (ISO_DATE_RE.test(a) && ISO_DATE_RE.test(b)) {
      const ta = Date.parse(a)
      const tb = Date.parse(b)
      if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta - tb
    }
    // numeric-looking strings → numeric
    const na = Number(a)
    const nb = Number(b)
    if (a.trim() !== '' && b.trim() !== '' && !Number.isNaN(na) && !Number.isNaN(nb)) {
      return na - nb
    }
    // Hebrew/English aware string compare
    return a.localeCompare(b, 'he')
  }

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() - b.getTime()
  }

  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return Number(a) - Number(b)
  }

  return String(a).localeCompare(String(b), 'he')
}

/**
 * Sort a copy of `rows` by the value `getValue` pulls out of each row.
 * Blanks stay last regardless of direction.
 */
export function sortRows<T>(rows: T[], getValue: (row: T) => unknown, dir: SortDir): T[] {
  const copy = [...rows]
  copy.sort((ra, rb) => {
    const va = getValue(ra)
    const vb = getValue(rb)
    // Keep blanks pinned to the bottom even when the direction flips.
    const aNil = isBlank(va)
    const bNil = isBlank(vb)
    if (aNil || bNil) return compareValues(va, vb)

    const base = compareValues(va, vb)
    return dir === 'asc' ? base : -base
  })
  return copy
}
