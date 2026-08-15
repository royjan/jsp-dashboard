'use client'

import { useMemo, useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { compareValues, sortRows, type SortDir } from '@/lib/sort'

// The comparator moved to `@/lib/sort` so <DataTable> and this hook order rows
// identically. Re-exported here for existing importers.
export { compareValues }
export type { SortDir }

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
    // sortRows keeps blank cells pinned last in BOTH directions; the previous
    // inline sort flipped them to the top on `desc`.
    return sortRows(rows, (row) => row[sortKey], sortDir)
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
