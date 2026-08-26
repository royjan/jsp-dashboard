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
 *    and tabular-nums on numeric cells. NOTE: `position: sticky` needs a scroll
 *    container with a BOUNDED height. The wrapper is `overflow-x-auto`, which per
 *    spec forces overflow-y to `auto` too — so it is already a scroll container,
 *    and without a height cap it just grows and the header never sticks. Long
 *    tables therefore get a default cap (see STICKY_MIN_ROWS below); 7 of the 16
 *    call sites passed no maxHeight and had an inert sticky header because of this.
 *  - Optional checkbox row-selection in the API (unused for now, but ready).
 *
 * It is intentionally presentational: sorting state is owned by the caller
 * (controlled via `sort` + `onSortChange`) so it matches the existing pages,
 * which already keep sort state in URL/query params.
 *
 * See DataTable.example.tsx for a copy-paste usage example.
 */

import * as React from 'react'
import { ArrowUpDown, Download, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ErrorState, EmptyState } from '@/components/ui/feedback-state'
import { sortRows, type SortDir } from '@/lib/sort'
import { formatNumber } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useDensity, type Density } from '@/lib/use-density'
import { exportRowsToXlsx, type ExportColumn } from '@/lib/export-table'

export type { SortDir }

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
   * Value to sort this column by when the table sorts ITSELF (uncontrolled
   * mode — see `defaultSort`). Without it an uncontrolled table falls back to
   * `row[sortKey ?? key]`, which is right for plain field columns and wrong
   * for computed ones — give those an explicit `sortValue`.
   */
  sortValue?: (row: TRow) => unknown
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
  /**
   * RAW value for the xlsx export — a number for anything numeric, never a
   * formatted string. Without it the export falls back to `cell()`, which is
   * correct only when that returns a primitive; a column whose cell renders a
   * badge or a link needs this.
   *
   * Return `null` to omit the column from the export entirely (row actions,
   * checkboxes, expand carets).
   */
  exportValue?: ((row: TRow, index: number) => string | number | null | undefined) | null
  /** Header text in the sheet. Defaults to `header` when it is a plain string. */
  exportHeader?: string
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

  // --- sorting ---
  /**
   * CONTROLLED sorting: the caller owns the state (typically in URL params)
   * and re-fetches or re-sorts itself. Pass both `sort` and `onSortChange`.
   */
  sort?: DataTableSort<TSortKey> | null
  onSortChange?: (sort: DataTableSort<TSortKey>) => void
  /**
   * UNCONTROLLED sorting: pass `defaultSort` and omit `sort`/`onSortChange`.
   * The table keeps its own sort state and orders `rows` in-memory with the
   * shared comparator (Hebrew-aware, ISO dates chronological, blanks last).
   * This is what lets a hand-rolled table move over without rewiring state.
   */
  defaultSort?: DataTableSort<TSortKey> | null

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
  /**
   * Max height for the vertical scroll area (keeps the sticky header useful).
   * Omit it and a table longer than STICKY_MIN_ROWS gets DEFAULT_MAX_HEIGHT so
   * its header actually sticks; short tables are left to flow with the page.
   * Pass `'none'` to opt out entirely (e.g. a table that is already inside its
   * own scroll area, where a second one traps the wheel).
   */
  maxHeight?: string
  /**
   * Row padding. Defaults to the app-wide density preference, so the toggle in
   * the top bar reaches every table without a per-page edit. Pass a value to
   * pin one table regardless of the preference.
   */
  density?: Density
  /** Number of skeleton rows while loading. Default 8. */
  loadingRows?: number
  /**
   * Render at most this many rows, with a footer saying how many are hidden and
   * a button to reveal the rest.
   *
   * This replaces the `rows.slice(0, 100)` idiom that pages used to apply
   * *before* handing rows over — that silently dropped data with nothing on
   * screen to say so, which on an inventory/AR table reads as "these are all
   * the customers" when it isn't. Truncating here keeps the cap (rows are not
   * virtualised, so a few thousand <tr> do cost) but makes it visible and
   * dismissible.
   */
  maxRows?: number
  className?: string
  /**
   * Setting this turns on the "ייצוא" button above the table. The file name is
   * suffixed with the date. The export always covers EVERY row the table holds,
   * not the visible page and not the `maxRows` slice — an export that silently
   * matched the truncation would be the same "these are all the rows" lie the
   * cap exists to avoid.
   */
  exportFileName?: string
  /** Sheet tab name; defaults to `exportFileName`. */
  exportSheetName?: string
  /** Extra controls rendered in the toolbar, before the export button. */
  toolbar?: React.ReactNode
  /** Localized strings (Hebrew-first by default). */
  labels?: Partial<DataTableLabels>
}

export interface DataTableLabels {
  loading: string
  empty: string
  error: string
  retry: string
  /** `(shown, total)` → e.g. "מוצגות 100 שורות מתוך 1,240" */
  truncated: (shown: number, total: number) => string
  showAll: string
  exportLabel: string
}

const DEFAULT_LABELS: DataTableLabels = {
  loading: 'טוען…',
  empty: 'אין נתונים להצגה',
  error: 'אירעה שגיאה בטעינת הנתונים',
  retry: 'נסה שוב',
  truncated: (shown, total) =>
    `מוצגות ${formatNumber(shown)} שורות מתוך ${formatNumber(total)}`,
  showAll: 'הצג הכל',
  exportLabel: 'ייצוא',
}

/**
 * Below this many rows a sticky header buys nothing — the table fits on screen —
 * and capping the height would add a scrollbar for no reason.
 */
const STICKY_MIN_ROWS = 18
/** Tall enough to be worth scrolling, short enough to leave the page usable. */
const DEFAULT_MAX_HEIGHT = '70vh'

const CELL_PAD = { comfortable: 'py-2.5', compact: 'py-1' } as const
const HEAD_PAD = { comfortable: 'py-2', compact: 'py-1' } as const

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
  rows: rowsProp,
  getRowKey,
  loading,
  error,
  onRetry,
  sort: sortProp,
  onSortChange,
  defaultSort,
  onRowClick,
  rowClassName,
  selectable,
  selectedKeys,
  onSelectionChange,
  minWidth = 'min-w-[700px]',
  maxHeight,
  density: densityProp,
  loadingRows = 8,
  maxRows,
  className,
  exportFileName,
  exportSheetName,
  toolbar,
  labels,
}: DataTableProps<TRow, TSortKey>) {
  // Column `cell` renderers call formatCurrency() from here, and that reads the
  // demo-mode mask from a module store React cannot see. Subscribing once in
  // the table re-renders every money cell in the app when the eye is toggled.
  useMoneyHidden()
  // The hook must run unconditionally — `densityProp ?? useDensity()` would
  // skip it whenever a caller pins the density, and React counts hooks.
  const preferredDensity = useDensity()
  const density = densityProp ?? preferredDensity
  const cellPad = CELL_PAD[density]
  const headPad = HEAD_PAD[density]
  const L = { ...DEFAULT_LABELS, ...labels }
  const colCount = columns.length + (selectable ? 1 : 0)

  // Controlled when the caller passes `sort`; otherwise the table owns it.
  const isControlled = sortProp !== undefined
  const [internalSort, setInternalSort] = React.useState<DataTableSort<TSortKey> | null>(
    defaultSort ?? null,
  )
  const sort = isControlled ? sortProp : internalSort

  const toggleSort = (col: DataTableColumn<TRow, TSortKey>) => {
    if (!col.sortable) return
    const field = (col.sortKey ?? col.key) as TSortKey
    // First click on a new column → 'desc' (biggest first, what you want on a
    // money/qty column); clicking the active column flips it.
    const nextDir: SortDir =
      sort?.field === field ? (sort.dir === 'asc' ? 'desc' : 'asc') : 'desc'
    const next: DataTableSort<TSortKey> = { field, dir: nextDir }

    if (isControlled) onSortChange?.(next)
    else setInternalSort(next)
  }

  // In uncontrolled mode the table does the ordering itself. Controlled callers
  // hand us rows already sorted, so leave them alone.
  const columnsByField = React.useMemo(() => {
    const map = new Map<string, DataTableColumn<TRow, TSortKey>>()
    for (const col of columns) map.set(String(col.sortKey ?? col.key), col)
    return map
  }, [columns])

  const sortedRows = React.useMemo(() => {
    if (isControlled || !sort) return rowsProp
    const col = columnsByField.get(String(sort.field))
    const getValue =
      col?.sortValue ??
      ((row: TRow) => (row as Record<string, unknown>)?.[String(sort.field)])
    return sortRows(rowsProp, getValue, sort.dir)
  }, [isControlled, sort, rowsProp, columnsByField])

  // Truncation is applied AFTER sorting, so "top 100" means the top 100 of the
  // current sort rather than of whatever order the API happened to return.
  const [showAll, setShowAll] = React.useState(false)
  const truncating = maxRows !== undefined && !showAll && sortedRows.length > maxRows
  const rows = truncating ? sortedRows.slice(0, maxRows) : sortedRows
  const hiddenCount = sortedRows.length - rows.length

  // A sticky header is inert without a bounded scroll container, so give long
  // tables a cap by default rather than leaving the header silently broken.
  const effectiveMaxHeight =
    maxHeight === 'none'
      ? undefined
      : (maxHeight ?? (rows.length > STICKY_MIN_ROWS ? DEFAULT_MAX_HEIGHT : undefined))

  // ----- selection helpers -----
  // NOTE: every hook must run before the `error` early-return below. This
  // useMemo used to sit AFTER it, so the first render that errored called one
  // hook fewer and React threw "rendered fewer hooks than expected" — the
  // error state could never actually paint.
  const allKeys = React.useMemo(() => rows.map((r, i) => getRowKey(r, i)), [rows, getRowKey])
  const allSelected = selectable && allKeys.length > 0 && allKeys.every(k => selectedKeys?.has(k))
  const someSelected = selectable && !allSelected && allKeys.some(k => selectedKeys?.has(k))

  const toggleAll = () => {
    if (!onSelectionChange) return
    onSelectionChange(allSelected ? new Set() : new Set(allKeys))
  }
  const [exporting, setExporting] = React.useState(false)
  const handleExport = React.useCallback(async () => {
    if (!exportFileName) return
    const exportColumns: ExportColumn<TRow>[] = columns
      .filter(col => col.exportValue !== null)
      .map(col => ({
        header:
          col.exportHeader ?? (typeof col.header === 'string' ? col.header : col.key),
        value: (row: TRow, i: number) => {
          if (col.exportValue) return col.exportValue(row, i)
          const v = col.cell(row, i)
          // Only a primitive is safe to write straight into a cell; a node
          // would stringify to "[object Object]".
          return typeof v === 'string' || typeof v === 'number' ? v : null
        },
      }))
    setExporting(true)
    try {
      // sortedRows, not `rows`: the export is not subject to the display cap.
      await exportRowsToXlsx(sortedRows, exportColumns, {
        fileName: exportFileName,
        sheetName: exportSheetName,
      })
    } catch (e) {
      console.error('[DataTable] export failed', e)
    } finally {
      setExporting(false)
    }
  }, [columns, sortedRows, exportFileName, exportSheetName])

  const toggleRow = (key: string | number) => {
    if (!onSelectionChange) return
    const next = new Set(selectedKeys)
    next.has(key) ? next.delete(key) : next.add(key)
    onSelectionChange(next)
  }

  // ----- non-data states: never render a blank table -----
  if (error) {
    return (
      <ErrorState
        variant="inline"
        title={L.error}
        description={errorMessage(error)}
        onRetry={onRetry}
        retryLabel={L.retry}
      />
    )
  }

  const showToolbar = Boolean(toolbar || exportFileName)

  const table = (
    <div
      className={cn(
        'overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0',
        effectiveMaxHeight && 'overflow-y-auto',
        !showToolbar && className,
      )}
      style={effectiveMaxHeight ? { maxHeight: effectiveMaxHeight } : undefined}
    >
      <table className={cn('w-full text-xs sm:text-sm', minWidth)}>
        {/* A sticky header needs an opaque background, and it has to be the
            surface it actually sits on — `bg-background` is darker than `bg-card`,
            which made the header read as a cropped rectangle inside the card. */}
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b text-muted-foreground">
            {selectable && (
              <th className={cn('w-8 ps-1 text-start', headPad)}>
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
                    headPad,
                    'font-medium whitespace-nowrap',
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
                {selectable && <td className={cn('ps-1', cellPad)}><div className="h-4 w-4 animate-pulse rounded bg-primary/10" /></td>}
                {columns.map(col => (
                  <td key={col.key} className={cn(cellPad, col.hideOnMobile && 'hidden sm:table-cell')}>
                    <div className={cn('h-4 animate-pulse rounded bg-primary/10', col.align === 'end' ? 'ms-auto w-12' : col.align === 'center' ? 'mx-auto w-12' : 'w-3/4')} />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="py-0">
                <EmptyState variant="inline" title={L.empty} />
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
                    <td className={cn('ps-1', cellPad)} onClick={e => e.stopPropagation()}>
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
                          cellPad,
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
      {hiddenCount > 0 && !loading && (
        <div className="flex flex-wrap items-center justify-center gap-2 border-t py-2.5 text-xs text-muted-foreground">
          <span>{L.truncated(rows.length, sortedRows.length)}</span>
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="cursor-pointer rounded-md border px-2 py-1 font-medium text-foreground transition-colors hover:bg-muted"
          >
            {L.showAll}
          </button>
        </div>
      )}
    </div>
  )

  if (!showToolbar) return table

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {toolbar}
        {exportFileName && (
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || loading || sortedRows.length === 0}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            title={`${L.exportLabel} (${formatNumber(sortedRows.length)})`}
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {L.exportLabel}
          </button>
        )}
      </div>
      {table}
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
