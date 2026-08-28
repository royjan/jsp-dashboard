'use client'

/**
 * <DataTable> — the shared table primitive for the Jan apps.
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
 * Wrap the app in <JanUIProvider> to inject formatNumber / useMoneyHidden;
 * without one it falls back to en-US grouping and no masking.
 */

import * as React from 'react'
import { ArrowUpDown, Download, Loader2 } from 'lucide-react'
import { cn } from './cn'
import { ErrorState as DefaultErrorState, EmptyState as DefaultEmptyState } from './feedback-state'
import { sortRows, type SortDir } from './sort'
import { useDensity, type Density } from './density'
import { exportRowsToXlsx, type ExportColumn } from './export-xlsx'
import { useJanUI } from './provider'

export type { SortDir }


/** Best-effort label for a column, for the derived mobile card's field list. */
function columnLabel<TRow, K extends string>(col: DataTableColumn<TRow, K>): string {
  if (col.exportHeader) return col.exportHeader
  if (typeof col.header === 'string') return col.header
  if (typeof col.header === 'number') return String(col.header)
  return col.key
}

/**
 * Build a card from the columns when the caller did not supply one.
 *
 * The picks: the first real column is the title, the LAST numeric column is
 * the accent — on these screens the number a row is really about (a total, a
 * balance, a count) sits at the end — and up to four more become labelled
 * fields.
 *
 * Four, not two, because this is a FALLBACK: a hand-written card drops the
 * columns its author judged unimportant, but a derived card that drops columns
 * is just losing data, and on a six-column table a cap of two was enough to
 * hide the headline metric (a retention rate, a margin) while keeping the
 * incidental ones.
 *
 * Action, checkbox and caret columns are skipped using the same marker the
 * export already uses for them: `exportValue: null` means "this column is
 * chrome, not data", and chrome does not belong on a card either.
 */
function deriveMobileCard<TRow, K extends string>(
  columns: DataTableColumn<TRow, K>[],
): DataTableProps<TRow, K>['mobileCard'] {
  const usable = columns.filter(c => c.exportValue !== null)
  if (usable.length === 0) return undefined

  const [titleCol, ...rest] = usable

  // Last numeric column, found without Array.findLastIndex so this keeps
  // working on the older lib targets two of the three consumers build against.
  let accentIdx = -1
  for (let i = rest.length - 1; i >= 0; i--) {
    if (rest[i].numeric ?? rest[i].align === 'end') { accentIdx = i; break }
  }
  const accentCol = accentIdx >= 0 ? rest[accentIdx] : undefined
  const remaining = rest.filter((_c, i) => i !== accentIdx)
  const subtitleCol = remaining[0]
  const fieldCols = remaining.slice(1).filter(c => !c.hideOnMobile).slice(0, 4)

  return {
    title: (row, i) => titleCol.cell(row, i),
    subtitle: subtitleCol ? (row, i) => subtitleCol.cell(row, i) : undefined,
    accent: accentCol ? (row, i) => accentCol.cell(row, i) : undefined,
    fields: fieldCols.map(c => ({ label: columnLabel(c), value: (row: TRow, i: number) => c.cell(row, i) })),
  }
}


/**
 * Where the card layout gives way to the real table, chosen from the table's
 * OWN width rather than fixed at `lg`.
 *
 * A fixed `lg` breakpoint means an 820px iPad gets the phone layout even for a
 * 560px-wide table that would have fitted with room to spare — a tablet has the
 * width for a real table and cards there throw it away. A 1200px table, on the
 * other hand, fits no tablet at all and should stay cards until a desktop.
 *
 * So: swap at the first Tailwind breakpoint whose viewport can actually hold
 * the table, allowing SWAP_GUTTER for page padding and any surrounding card.
 *
 * The class strings are literals because Tailwind's scanner reads source text —
 * a computed `${bp}:hidden` would produce classes that never get generated.
 */
const SWAP_GUTTER = 48

const SWAP_AT = {
  sm: { cards: 'sm:hidden', table: 'hidden sm:block' },
  md: { cards: 'md:hidden', table: 'hidden md:block' },
  lg: { cards: 'lg:hidden', table: 'hidden lg:block' },
  xl: { cards: 'xl:hidden', table: 'hidden xl:block' },
} as const

/** Tailwind's default breakpoints, smallest first. */
const BREAKPOINTS: Array<[keyof typeof SWAP_AT, number]> = [
  ['sm', 640],
  ['md', 768],
  ['lg', 1024],
  ['xl', 1280],
]

function swapClasses(minWidth: string | undefined) {
  // `min-w-[860px]` -> 860. Anything unparseable falls back to lg, the old
  // behaviour, rather than guessing.
  const px = Number(/min-w-\[(\d+)px\]/.exec(minWidth ?? '')?.[1])
  if (!Number.isFinite(px)) return SWAP_AT.lg
  const hit = BREAKPOINTS.find(([, w]) => w >= px + SWAP_GUTTER)
  return SWAP_AT[hit ? hit[0] : 'xl']
}

/** Rows past this index all share one entrance delay — see `.jan-row-in`. */
const ROW_STAGGER_CAP = 12

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
  /**
   * Rows per page. Setting it turns on a real pager and turns OFF the automatic
   * height cap, so the table flows with the document instead of scrolling
   * inside itself.
   *
   * Worth being explicit about why both: the auto cap exists so a long table's
   * sticky header has something to stick to, but on a 94-row list it produced a
   * scroll area nested inside the page's own scroll area, showing eight rows
   * with no indication that eighty-six more existed. Nested scrollbars are easy
   * to miss and hard to use; "1–25 of 94" is neither.
   */
  pageSize?: number
  /** Extra controls rendered in the toolbar, before the export button. */
  toolbar?: React.ReactNode
  /**
   * Render a detail panel underneath a row, in a full-width second `<tr>`.
   *
   * Return null for a row that has nothing to show and it stays un-expandable —
   * no caret, no pointer cursor, no click target. That per-row decision is why
   * this is a render function rather than a boolean: on a document list, only
   * the rows that actually carry a document number can open.
   *
   * The panel is only MOUNTED while open, so a detail that fetches does not
   * fire a request per row on first paint.
   */
  renderExpanded?: (row: TRow, index: number) => React.ReactNode
  /**
   * Which rows are open, keyed by `getRowKey`. Controlled by the caller so it
   * can enforce whatever policy it wants — pass a one-element Set for an
   * accordion, a growing Set to allow several open at once.
   */
  expandedKeys?: Set<string | number>
  onExpandedChange?: (keys: Set<string | number>) => void
  /**
   * Stagger the rows in as they mount. On by default — it is what makes a
   * table land rather than blink into place, and it costs nothing on a table
   * that is already painted, because React reuses a <tr> by key and CSS
   * animations only replay for genuinely new elements.
   *
   * Turn it off for a table that is nested inside something already animating,
   * where two entrances fight each other.
   *
   * Reduced-motion is handled globally by the `.jan-anim` rule in tokens.css;
   * no call site has to think about it.
   */
  animateRows?: boolean
  /**
   * Below `lg`, render each row as a stacked card instead of a table row.
   *
   * The dense tables on this app are 6-8 columns wide, and on a 390px screen
   * that means horizontal scroll plus pinch-zoom — with the two columns a rep
   * in the field actually needs (price and stock) landing off-screen. Pinch
   * zoom is the a11y fallback, not the design.
   *
   * `title` and `subtitle` are the always-visible line; `fields` are the
   * labelled pairs beneath.
   *
   * OMIT IT and the table derives a card from the columns (see
   * `deriveMobileCard`). A hand-written card is still better — a card is a
   * different information hierarchy from a row, not a narrower one — but this
   * prop used to be the only way to get one, and the result was that most
   * tables silently had none and shipped a 900px-wide grid to a phone. A
   * derived card beats no card.
   *
   * Pass `false` to keep the scrolling table on small screens. That is the
   * right choice when the table's SHAPE is the information — a month-by-month
   * matrix or a source×status crosstab reads as a grid or not at all.
   */
  mobileCard?: false | {
    title: (row: TRow, index: number) => React.ReactNode
    subtitle?: (row: TRow, index: number) => React.ReactNode
    /** Trailing value on the title line — the number the row is really about. */
    accent?: (row: TRow, index: number) => React.ReactNode
    fields?: Array<{ label: string; value: (row: TRow, index: number) => React.ReactNode }>
  }
  /**
   * Footer row(s), rendered in a <tfoot> — pass <tr>…</tr>, not a <div>.
   *
   * This exists because several hand-rolled tables carry a totals row, and
   * without a slot for it "migrate to DataTable" silently drops the totals off
   * a money screen. It receives the rows the table is SHOWING plus the full
   * set, since a total under a truncated table has to say which one it is.
   *
   * Sticks to the bottom of the scroll area for the same reason the header
   * sticks to the top: on a long table the total is the line you are scrolling
   * to check.
   */
  footer?: (shown: TRow[], all: TRow[]) => React.ReactNode
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
  /** `(from, to, total)` → "מוצגות 1–25 מתוך 94" */
  pageRange: (from: number, to: number, total: number) => string
  prevPage: string
  nextPage: string
}

const DEFAULT_LABELS: DataTableLabels = {
  loading: 'טוען…',
  empty: 'אין נתונים להצגה',
  error: 'אירעה שגיאה בטעינת הנתונים',
  retry: 'נסה שוב',
  // Row counts, not money — they take plain grouping rather than the host
  // app's formatter, which is a hook and cannot be reached from module scope.
  truncated: (shown, total) =>
    `מוצגות ${shown.toLocaleString('en-US')} שורות מתוך ${total.toLocaleString('en-US')}`,
  showAll: 'הצג הכל',
  exportLabel: 'ייצוא',
  pageRange: (from, to, total) =>
    `מוצגות ${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} מתוך ${total.toLocaleString('en-US')}`,
  prevPage: 'הקודם',
  nextPage: 'הבא',
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
  animateRows = true,
  renderExpanded,
  expandedKeys,
  onExpandedChange,
  minWidth = 'min-w-[700px]',
  maxHeight,
  density: densityProp,
  loadingRows = 8,
  maxRows,
  className,
  exportFileName,
  exportSheetName,
  pageSize,
  toolbar,
  footer,
  mobileCard,
  labels,
}: DataTableProps<TRow, TSortKey>) {
  // Column `cell` renderers call formatCurrency() from here, and that reads the
  // demo-mode mask from a module store React cannot see. Subscribing once in
  // the table re-renders every money cell in the app when the eye is toggled.
  // The two things a table needs from its host app: how this app formats a
  // number, and whether it is currently masking money. Everything else the
  // table used to import lives in this package.
  const ui = useJanUI()
  const { formatNumber, useMoneyHidden } = ui
  // An app with richer states of its own keeps them — adopting the table must
  // not restyle every error in the app as a side effect.
  const ErrorState = ui.ErrorState ?? DefaultErrorState
  const EmptyState = ui.EmptyState ?? DefaultEmptyState
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

  // ----- paging -----
  const [page, setPage] = React.useState(0)
  const pageCount = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1
  // A filter that shrinks the list can strand the viewer on a page that no
  // longer exists. Clamping on READ handles that with no effect and no extra
  // render: every consumer below reads safePage, and the two handlers clamp
  // again when they write. Syncing `page` back down in an effect would only add
  // a cascading render to reach the same slice.
  const safePage = Math.min(page, pageCount - 1)
  const pagedRows = pageSize ? rows.slice(safePage * pageSize, safePage * pageSize + pageSize) : rows

  // A sticky header is inert without a bounded scroll container, so give long
  // tables a cap by default rather than leaving the header silently broken.
  //
  // `pageSize` normally turns the automatic cap OFF — a 25-row page fits, and a
  // scroll area nested in the page's own is worse than none. But an EXPLICIT
  // maxHeight still wins: a wide grid with a 50-row page (the comparison one)
  // scrolls past its header long before the pager, and there the caller is
  // asking for the sticky header on purpose.
  const effectiveMaxHeight =
    maxHeight === 'none'
      ? undefined
      : (maxHeight ?? (!pageSize && rows.length > STICKY_MIN_ROWS ? DEFAULT_MAX_HEIGHT : undefined))

  // ----- selection helpers -----
  // NOTE: every hook must run before the `error` early-return below. This
  // useMemo used to sit AFTER it, so the first render that errored called one
  // hook fewer and React threw "rendered fewer hooks than expected" — the
  // error state could never actually paint.
  const toggleExpanded = (key: string | number) => {
    if (!onExpandedChange) return
    const next = new Set(expandedKeys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onExpandedChange(next)
  }

  const allKeys = React.useMemo(() => rows.map((r, i) => getRowKey(r, i)), [rows, getRowKey])
  const allSelected = selectable && allKeys.length > 0 && allKeys.every(k => selectedKeys?.has(k))
  const someSelected = selectable && !allSelected && allKeys.some(k => selectedKeys?.has(k))

  const toggleAll = () => {
    if (!onSelectionChange) return
    // Only touch the rows THIS table is showing, and leave the rest of the
    // caller's Set alone. The caller may be holding keys for rows that are
    // currently filtered out — a header checkbox that replaces the whole Set
    // turns "select everything here" into "select everything here and silently
    // drop what I picked before I filtered".
    const next = new Set(selectedKeys)
    if (allSelected) for (const k of allKeys) next.delete(k)
    else for (const k of allKeys) next.add(k)
    onSelectionChange(next)
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

  // Where cards give way to the table, from this table's own minWidth.
  const swap = swapClasses(minWidth)

  // `undefined` means "derive one"; `false` means "keep the scrolling table".
  const effectiveCard = React.useMemo(
    () => (mobileCard === false ? undefined : (mobileCard ?? deriveMobileCard(columns))),
    [mobileCard, columns],
  )

  const cards = effectiveCard && !loading && pagedRows.length > 0 && (
    <div data-jan-ui="cards" className={cn('flex flex-col gap-2', swap.cards)}>
      {pagedRows.map((row, i) => {
        const key = getRowKey(row, i)
        return (
          <div
            key={key}
            onClick={onRowClick ? () => onRowClick(row, i) : undefined}
            className={cn(
              'rounded-lg border bg-card p-3 transition-colors',
              onRowClick && 'cursor-pointer active:bg-muted/50',
              selectedKeys?.has(key) && 'bg-primary/5',
              rowClassName?.(row, i),
            )}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 flex-1 truncate font-medium">{effectiveCard.title(row, i)}</span>
              {effectiveCard.accent && (
                <span className="shrink-0 tabular-nums font-semibold">{effectiveCard.accent(row, i)}</span>
              )}
            </div>
            {effectiveCard.subtitle && (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {effectiveCard.subtitle(row, i)}
              </div>
            )}
            {effectiveCard.fields && effectiveCard.fields.length > 0 && (
              <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {effectiveCard.fields.map(f => (
                  <div key={f.label} className="flex gap-1.5">
                    <dt className="text-muted-foreground">{f.label}</dt>
                    <dd className="tabular-nums">{f.value(row, i)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )
      })}
    </div>
  )

  // The scrolling grid, and the chrome under it (loader, pager, truncation
  // notice) as SIBLINGS rather than children: once the container has a height
  // cap, anything inside it scrolls with the rows, and a pager you have to
  // scroll fifty rows to reach is a pager nobody finds. The container's
  // `-mx-3 px-3` pair nets to zero, so chrome outside it stays aligned.
  const table = (
    <>
    <div
      data-jan-ui="table"
      className={cn(
        'overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0',
        // When cards are configured the table is the desktop presentation only.
        effectiveCard && swap.table,
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
          ) : pagedRows.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="py-0">
                <EmptyState variant="inline" title={L.empty} />
              </td>
            </tr>
          ) : (
            pagedRows.map((row, i) => {
              const key = getRowKey(row, i)
              const selected = selectedKeys?.has(key)
              // Ask for the panel BEFORE deciding the row is expandable: a row
              // whose detail comes back null gets no caret and no click target,
              // which is how a document list keeps its number-less rows inert.
              const expandedContent = renderExpanded?.(row, i)
              const expandable = expandedContent != null
              const isExpanded = expandable && !!expandedKeys?.has(key)
              return (
                <React.Fragment key={key}>
                <tr
                  className={cn(
                    'border-b transition-colors',
                    animateRows && 'jan-anim jan-row-in',
                    (onRowClick || expandable) && 'cursor-pointer hover:bg-muted/50',
                    selected && 'bg-primary/5',
                    isExpanded && 'bg-muted/30',
                    rowClassName?.(row, i),
                  )}
                  aria-expanded={expandable ? isExpanded : undefined}
                  // Capped: see the note on .jan-row-in. Beyond ROW_STAGGER_CAP
                  // every remaining row shares the last delay and they land
                  // together, which is what you want at the bottom of a long page.
                  style={
                    animateRows
                      ? ({ '--jan-row-i': Math.min(i, ROW_STAGGER_CAP) } as React.CSSProperties)
                      : undefined
                  }
                  onClick={
                    onRowClick || expandable
                      ? () => {
                          onRowClick?.(row, i)
                          if (expandable) toggleExpanded(key)
                        }
                      : undefined
                  }
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
                {isExpanded && (
                  <tr className="border-b">
                    <td colSpan={colCount} className="bg-muted/30 p-0">
                      {expandedContent}
                    </td>
                  </tr>
                )}
                </React.Fragment>
              )
            })
          )}
        </tbody>
        {footer && !loading && pagedRows.length > 0 && (
          <tfoot className="sticky bottom-0 z-10 border-t-2 bg-card font-semibold">
            {footer(pagedRows, sortedRows)}
          </tfoot>
        )}
      </table>
    </div>
      {loading && (
        <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground" aria-live="polite">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {L.loading}
        </div>
      )}
      {pageSize && !loading && rows.length > 0 && pageCount > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t py-2.5 text-xs">
          <span className="text-muted-foreground tabular-nums">
            {L.pageRange(safePage * pageSize + 1, safePage * pageSize + pagedRows.length, rows.length)}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              className="cursor-pointer rounded-md border px-2.5 py-1 font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              {L.prevPage}
            </button>
            <span className="px-1 text-muted-foreground tabular-nums">
              {safePage + 1}/{pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
              disabled={safePage >= pageCount - 1}
              className="cursor-pointer rounded-md border px-2.5 py-1 font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              {L.nextPage}
            </button>
          </div>
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
    </>
  )

  if (!showToolbar) {
    return cards ? (
      <>
        {cards}
        {table}
      </>
    ) : (
      table
    )
  }

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
      {cards}
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
