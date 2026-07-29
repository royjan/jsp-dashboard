'use client'

import { useMemo, useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SortDir = 'asc' | 'desc'

// ISO date detection: 2024-01-31, 2024-01-31T12:00:00Z, etc.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/

function compareValues(a: unknown, b: unknown): number {
  // Null/undefined sort last (regardless of direction — applied before dir flip).
  const aNil = a === null || a === undefined || a === ''
  const bNil = b === null || b === undefined || b === ''
  if (aNil && bNil) return 0
  if (aNil) return 1
  if (bNil) return -1

  // Numbers
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }

  // Strings
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

  // Mixed / fallback
  return String(a).localeCompare(String(b), 'he')
}

export interface UseSortableResult<T> {
  sorted: T[]
  sortKey: keyof T | null
  sortDir: SortDir
  toggleSort: (key: keyof T) => void
}

export function useSortable<T>(
  rows: T[],
  initial?: { key: keyof T; dir?: SortDir }
): UseSortableResult<T> {
  const [sortKey, setSortKey] = useState<keyof T | null>(initial?.key ?? null)
  const [sortDir, setSortDir] = useState<SortDir>(initial?.dir ?? 'asc')

  const toggleSort = (key: keyof T) => {
    if (key === sortKey) {
      // Cycle asc → desc on repeated clicks on the same column.
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const copy = [...rows]
    copy.sort((ra, rb) => {
      const base = compareValues(ra[sortKey], rb[sortKey])
      return sortDir === 'asc' ? base : -base
    })
    return copy
  }, [rows, sortKey, sortDir])

  return { sorted, sortKey, sortDir, toggleSort }
}

interface SortableThProps<T> {
  label: React.ReactNode
  sortKey: keyof T
  sortDir: SortDir
  activeKey: keyof T | null
  onSort: (key: keyof T) => void
  align?: 'start' | 'end' | 'center'
  className?: string
  /** Plain-language explanation of the column, shown on hover. */
  hint?: string
}

export function SortableTh<T>({
  label,
  sortKey,
  sortDir,
  activeKey,
  onSort,
  align = 'start',
  className,
  hint,
}: SortableThProps<T>) {
  const isActive = activeKey === sortKey
  const Icon = isActive && sortDir === 'desc' ? ChevronDown : ChevronUp

  const justify =
    align === 'end' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'
  const textAlign = align === 'end' ? 'text-end' : align === 'center' ? 'text-center' : 'text-start'

  return (
    <th className={cn('font-medium', textAlign, className)} title={hint}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 w-full select-none hover:text-foreground transition-colors',
          justify,
          isActive && 'text-foreground'
        )}
      >
        <span className={cn(hint && 'decoration-dotted underline-offset-4 hover:underline')}>{label}</span>
        <Icon
          className={cn(
            'h-3.5 w-3.5 shrink-0 transition-opacity',
            isActive ? 'opacity-100' : 'opacity-30'
          )}
        />
      </button>
    </th>
  )
}
