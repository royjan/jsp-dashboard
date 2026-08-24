'use client'

/**
 * The books' table: <DataTable> wired to server-side sorting and paging.
 *
 * DataTable in controlled mode reports a header click without reordering
 * anything, which is exactly right here — the server already returned the
 * sorted, filtered page, and re-sorting it in the browser would rank one page
 * instead of the whole set.
 */

import { useMemo } from 'react'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { BooksPager } from './BooksChrome'
import type { BooksScopeState } from './use-books-scope'

/** Cells carry no inline gutter of their own, so adjacent Hebrew columns run
 *  together without this. */
export const GUTTER = 'pe-4'

export function withGutter<T>(columns: DataTableColumn<T>[]): DataTableColumn<T>[] {
  return columns.map((c, i) => i === columns.length - 1 ? c : {
    ...c,
    cellClassName: [c.cellClassName, GUTTER].filter(Boolean).join(' '),
    headerClassName: [c.headerClassName, GUTTER].filter(Boolean).join(' '),
  })
}

export function BooksTable<T>({
  columns, rows, total, scope, loading, error, onRetry, getRowKey,
  maxHeight = '70vh', emptyLabel, footer,
}: {
  columns: DataTableColumn<T>[]
  rows: T[]
  total: number
  scope: BooksScopeState
  loading?: boolean
  error?: unknown
  onRetry?: () => void
  getRowKey: (row: T, index: number) => string | number
  maxHeight?: string
  emptyLabel?: string
  footer?: React.ReactNode
}) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const spaced = useMemo(() => withGutter(columns), [columns])

  return (
    <div className="space-y-2">
      <DataTable<T>
        columns={spaced}
        rows={rows}
        getRowKey={getRowKey}
        loading={loading}
        error={error}
        onRetry={onRetry}
        sort={scope.sort ? { field: scope.sort, dir: scope.dir } : null}
        onSortChange={({ field }) => scope.setSort(field)}
        maxHeight={maxHeight}
        labels={emptyLabel ? { empty: emptyLabel } : undefined}
      />
      {footer}
      <BooksPager scope={scope} shown={rows.length} total={total} />
    </div>
  )
}

/** The totals line under a money table — DataTable has no <tfoot>, and a trial
 *  balance without its totals is not a trial balance. */
export function BooksTotals({ items }: { items: Array<{ label: string; value: string; tone?: 'good' | 'bad' }> }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-4 rounded-lg border bg-muted/40 px-4 py-2 text-sm font-semibold">
      {items.map((item) => (
        <span key={item.label} className="flex items-baseline gap-2">
          <span className="text-xs font-normal text-muted-foreground">{item.label}</span>
          <span className={
            item.tone === 'good' ? 'tabular-nums text-emerald-600 dark:text-emerald-400'
              : item.tone === 'bad' ? 'tabular-nums text-red-600 dark:text-red-400'
              : 'tabular-nums'}>{item.value}</span>
        </span>
      ))}
    </div>
  )
}
