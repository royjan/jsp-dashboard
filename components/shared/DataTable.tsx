'use client'

/**
 * <DataTable> — a single shared table primitive for the dashboard.
 *
 * Goals (see the P2 UX review):
 *  - Consistent sort UX with an active-direction indicator (▲ / ▼).
 *  - RTL/Hebrew-correct via LOGICAL CSS props only (text-start/text-end, ms-/me-),
 *    never physical left/right — so it renders correctly under dir="rtl" AND dir="ltr".
 *  - Explicit loading / empty / error+retry states so a table can NEVER render blank
 *    on failure (3 hand-rolled tables currently do).
 *  - Sticky header, horizontal-overflow container, cell truncation WITH title= tooltip,
 *    and tabular-nums on numeric cells.
 *  - Optional checkbox row-selection in the API (unused for now, but ready).
 *
 * It is intentionally presentational: sorting state is owned by the caller
 * (controlled via `sort` + `onSortChange`) so it matches the existing pages,
 * which already keep sort state in URL/query params.
 *
 * See DataTable.example.tsx for a copy-paste usage example.
 */

import * as React from 'react'
import { ArrowUpDown, AlertTriangle, RefreshCw, Inbox, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SortDir = 'asc' | 'desc'

export interface DataTableSort<TSortKey extends string = string> {
  field: TSortKey
  dir: SortDir
}

export interface DataTableColumn<TRow, TSortKey extends string = string> {
  /** Stable key — also used as the sort field when `sortable` is true and no `sortKey` given. */
  key: string
  /** Header content (string or node). Keep it short; it lives in a sticky header. */
  header: React.ReactNode
  /** Cell renderer. Return a primitive or a node. */
  cell: (row: TRow, rowIndex: number) => React.ReactNode
  /**
   * Text alignment. Uses LOGICAL alignment:
   *  - 'start'  → text-start  (right in RTL, left in LTR)  — default, for labels/text
   *  - 'end'    → text-end    (left in RTL, right in LTR)  — use for numbers
   *  - 'center' → text-center
   */
  align?: 'start' | 'end' | 'center'
  /** Render as tabular-nums (aligned digits). Auto-on when align==='end' unless set false. */
  numeric?: boolean
  /** Make this column sortable. */
  sortable?: boolean
  /** Sort field emitted to onSortChange; defaults to `key`. */
  sortKey?: TSortKey
  /**
   * Truncate the cell to a single line with ellipsis and attach a title= tooltip.
   * Pass a Tailwind max-width (e.g. 'max-w-[200px]') or `true` for a sensible default.
   */
  truncate?: boolean | string
  /**
   * Value used for the truncation `title=` tooltip. Defaults to the cell value
   * when it is a string/number. Provide this when `cell` returns a node.
   */
  title?: (row: TRow) => string | undefined
  /** Extra classes on the <th>. */
  headerClassName?: string
  /** Extra classes on the <td>. */
  cellClassName?: string
  /** Hide on small screens (applies `hidden sm:table-cell`). */
  hideOnMobile?: boolean
}

export interface DataTableProps<TRow, TSortKey extends string = string> {
  columns: DataTableColumn<TRow, TSortKey>[]
  rows: TRow[]
  /** Stable React key per row. */
  getRowKey: (row: TRow, index: number) => string | number

  // --- async states (mutually applied in priority: error > loading > empty) ---
  loading?: boolean
  /** Truthy error → renders the error+retry block instead of a blank table. */
  error?: unknown
  onRetry?: () => void

  // --- sorting (controlled) ---
  sort?: DataTableSort<TSortKey> | null
  onSortChange?: (sort: DataTableSort<TSortKey>) => void

  // --- row interaction ---
  onRowClick?: (row: TRow, index: number) => void
  /** Per-row className (e.g. highlight expanded/selected rows). */
  rowClassName?: (row: TRow, index: number) => string | undefined

  // --- optional checkbox selection (API present even if unused) ---
  selectable?: boolean
  selectedKeys?: Set<string | number>
  onSelectionChange?: (keys: Set<string | number>) => void

  // --- presentation ---
  /** Min width to force horizontal scroll rather than column crush. Default 'min-w-[700px]'. */
  minWidth?: string
  /** Max height for the vertical scroll area (keeps the sticky header useful). */
  maxHeight?: string
  /** Number of skeleton rows while loading. Default 8. */
  loadingRows?: number
  className?: string
  /** Localized strings (Hebrew-first by default). */
  labels?: Partial<DataTableLabels>
}

export interface DataTableLabels {
  loading: string
  empty: string
  error: string
  retry: string
}

const DEFAULT_LABELS: DataTableLabels = {
  loading: 'טוען…',
  empty: 'אין נתונים להצגה',
  error: 'אירעה שגיאה בטעינת הנתונים',
  retry: 'נסה שוב',
}

const alignClass = (align: DataTableColumn<unknown>['align']) =>
  align === 'end' ? 'text-end' : align === 'center' ? 'text-center' : 'text-start'

function truncateClass(truncate: boolean | string | undefined): string {
  if (!truncate) return ''
  const max = typeof truncate === 'string' ? truncate : 'max-w-[220px]'
  return cn('truncate', max)
}

function defaultTitle(value: React.ReactNode): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined
}

export function DataTable<TRow, TSortKey extends string = string>({
  columns,
  rows,
  getRowKey,
  loading,
  error,
  onRetry,
  sort,
  onSortChange,
  onRowClick,
  rowClassName,
  selectable,
  selectedKeys,
  onSelectionChange,
  minWidth = 'min-w-[700px]',
  maxHeight,
  loadingRows = 8,
  className,
  labels,
}: DataTableProps<TRow, TSortKey>) {
  const L = { ...DEFAULT_LABELS, ...labels }
  const colCount = columns.length + (selectable ? 1 : 0)

  const toggleSort = (col: DataTableColumn<TRow, TSortKey>) => {
    if (!col.sortable || !onSortChange) return
    const field = (col.sortKey ?? col.key) as TSortKey
    const nextDir: SortDir = sort?.field === field && sort.dir === 'asc' ? 'desc' : sort?.field === field ? 'asc' : 'desc'
    onSortChange({ field, dir: nextDir })
  }

  // ----- non-data states: never render a blank table -----
  if (error) {
    return (
      <StatePanel
        icon={<AlertTriangle className="h-6 w-6 text-destructive" />}
        title={L.error}
        message={errorMessage(error)}
        action={
          onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {L.retry}
            </button>
          ) : undefined
        }
      />
    )
  }

  // ----- selection helpers -----
  const allKeys = React.useMemo(() => rows.map((r, i) => getRowKey(r, i)), [rows, getRowKey])
  const allSelected = selectable && allKeys.length > 0 && allKeys.every(k => selectedKeys?.has(k))
  const someSelected = selectable && !allSelected && allKeys.some(k => selectedKeys?.has(k))

  const toggleAll = () => {
    if (!onSelectionChange) return
    onSelectionChange(allSelected ? new Set() : new Set(allKeys))
  }
  const toggleRow = (key: string | number) => {
    if (!onSelectionChange) return
    const next = new Set(selectedKeys)
    next.has(key) ? next.delete(key) : next.add(key)
    onSelectionChange(next)
  }

  return (
    <div className={cn('overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0', maxHeight && 'overflow-y-auto', className)} style={maxHeight ? { maxHeight } : undefined}>
      <table className={cn('w-full text-xs sm:text-sm', minWidth)}>
        {/* A sticky header needs an opaque background, and it has to be the
            surface it actually sits on — `bg-background` is darker than `bg-card`,
            which made the header read as a cropped rectangle inside the card. */}
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b text-muted-foreground">
            {selectable && (
              <th className="w-8 py-2 ps-1 text-start">
                <input
                  type="checkbox"
                  aria-label="select all rows"
                  className="cursor-pointer align-middle accent-primary"
                  checked={!!allSelected}
                  ref={el => { if (el) el.indeterminate = !!someSelected }}
                  onChange={toggleAll}
                />
              </th>
            )}
            {columns.map(col => {
              const field = (col.sortKey ?? col.key) as TSortKey
              const active = sort?.field === field
              return (
                <th
                  key={col.key}
                  className={cn(
                    'py-2 font-medium whitespace-nowrap',
                    alignClass(col.align),
                    col.sortable && 'cursor-pointer select-none hover:text-foreground transition-colors',
                    col.hideOnMobile && 'hidden sm:table-cell',
                    col.headerClassName,
                  )}
                  onClick={() => toggleSort(col)}
                  aria-sort={col.sortable ? (active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                >
                  <span className={cn('inline-flex items-center gap-1', col.align === 'end' && 'flex-row-reverse', col.align === 'center' && 'justify-center')}>
                    {col.header}
                    {col.sortable && (
                      <>
                        <ArrowUpDown className={cn('h-3 w-3 shrink-0', active ? 'text-primary' : 'text-muted-foreground/30')} />
                        {active && <span className="text-primary text-[10px]">{sort!.dir === 'desc' ? '▼' : '▲'}</span>}
                      </>
                    )}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: loadingRows }).map((_, r) => (
              <tr key={`sk-${r}`} className="border-b">
                {selectable && <td className="py-2.5 ps-1"><div className="h-4 w-4 animate-pulse rounded bg-primary/10" /></td>}
                {columns.map(col => (
                  <td key={col.key} className={cn('py-2.5', col.hideOnMobile && 'hidden sm:table-cell')}>
                    <div className={cn('h-4 animate-pulse rounded bg-primary/10', col.align === 'end' ? 'ms-auto w-12' : col.align === 'center' ? 'mx-auto w-12' : 'w-3/4')} />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="py-0">
                <StatePanel icon={<Inbox className="h-6 w-6 text-muted-foreground/60" />} title={L.empty} />
              </td>
            </tr>
          ) : (
            rows.map((row, i) => {
              const key = getRowKey(row, i)
              const selected = selectedKeys?.has(key)
              return (
                <tr
                  key={key}
                  className={cn(
                    'border-b transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-muted/50',
                    selected && 'bg-primary/5',
                    rowClassName?.(row, i),
                  )}
                  onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                >
                  {selectable && (
                    <td className="py-2.5 ps-1" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label="select row"
                        className="cursor-pointer align-middle accent-primary"
                        checked={!!selected}
                        onChange={() => toggleRow(key)}
                      />
                    </td>
                  )}
                  {columns.map(col => {
                    const value = col.cell(row, i)
                    const isNumeric = col.numeric ?? col.align === 'end'
                    const title = col.truncate ? (col.title ? col.title(row) : defaultTitle(value)) : undefined
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          'py-2.5',
                          alignClass(col.align),
                          isNumeric && 'tabular-nums',
                          col.hideOnMobile && 'hidden sm:table-cell',
                          col.cellClassName,
                        )}
                        title={title}
                      >
                        {/* The clamp has to sit on a block-level child: browsers
                            ignore max-width on a <td> under auto table layout,
                            so putting it here is what makes `truncate` work. */}
                        {col.truncate ? <div className={truncateClass(col.truncate)}>{value}</div> : value}
                      </td>
                    )
                  })}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
      {loading && (
        <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground" aria-live="polite">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {L.loading}
        </div>
      )}
    </div>
  )
}

function StatePanel({ icon, title, message, action }: { icon: React.ReactNode; title: string; message?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      {icon}
      <div className="text-sm font-medium text-foreground">{title}</div>
      {message && <div className="max-w-md text-xs text-muted-foreground">{message}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

function errorMessage(error: unknown): string | undefined {
  if (!error) return undefined
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return undefined
}

export default DataTable
