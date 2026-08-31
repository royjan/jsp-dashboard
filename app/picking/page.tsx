'use client'

/**
 * The picking floor — the step between the shelf and the driver, which had no
 * screen. /shipments is goods coming in, /deliveries starts once a driver has
 * the box; what happens in between lived only in the warehouse app.
 *
 * The panel worth reading is the second one. A line a picker marked unavailable
 * is the ERP being contradicted by somebody standing at the shelf, and no other
 * source on this dashboard can see it — everything else here reads the ERP,
 * which is exactly the thing being contradicted.
 *
 * Stock, price and shelf are deliberately absent from this page. Invagent's copy
 * of them is a stale mirror of the ERP's, and /stock already shows the live one.
 */

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { PackageSearch, AlertTriangle, Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { ItemLink } from '@/components/shared/ItemLink'
import { CustomerLink } from '@/components/shared/CustomerLink'
import { formatNumber } from '@/lib/format'
import { statusLabel, priorityLabel, reasonLabel, statusRank, priorityRank, isHotPriority } from '@/lib/picking-labels'
import { usePicking, type PickOrder, type DisputeGroup, type ShippedOrder, type DocRef } from '@/hooks/use-picking'

/**
 * The document, where the rest of the dashboard already knows how to show it.
 *
 * Unresolved rows stay plain text rather than becoming a link to a guessed
 * format — /documents/[format]/[number] would happily render somebody else's
 * document under this order's number.
 */
/**
 * Start the document fetch on hover, so the click does not begin a cold one.
 *
 * FINAPI reverse-scans its header file for a single document, and the cost grows
 * with how far back the document sits — 4.6s for the newest, 14-35s a few
 * thousand back, a 60s upstream timeout for the oldest. Our own cache is 7 days,
 * so this is only ever paid once per document by whoever opens it first; hover
 * moves that payment to a moment when nobody is staring at a blank page.
 *
 * The query key is the one the document page itself uses, so the click reuses
 * this request rather than starting a second one.
 *
 * Two limits keep the hint from becoming a load generator on the ERP box: a
 * dwell delay, so sweeping the pointer down a 50-row table fires nothing, and a
 * per-session ceiling, because each prefetch can occupy that box for half a
 * minute and a curious pointer must not be able to queue fifty of them.
 */
const PREFETCH_DWELL_MS = 400
const PREFETCH_MAX = 8
let prefetched = 0

function prefetchDocument(qc: QueryClient, doc: DocRef) {
  const key = ['document', doc.format, doc.docNumber, doc.year || '']
  if (qc.getQueryState(key)) return
  if (prefetched >= PREFETCH_MAX) return
  prefetched += 1
  qc.prefetchQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`/api/documents/${doc.format}/${doc.docNumber}${doc.year ? `?year=${doc.year}` : ''}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
  })
}

function DocumentCell({ documentNumber, doc }: { documentNumber: string; doc?: DocRef | null }) {
  const qc = useQueryClient()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const start = () => {
    if (!doc || timer.current) return
    timer.current = setTimeout(() => { timer.current = null; prefetchDocument(qc, doc) }, PREFETCH_DWELL_MS)
  }
  const cancel = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
  }

  if (!doc) return <span className="font-mono text-xs">{documentNumber}</span>
  return (
    <Link
      href={`/documents/${encodeURIComponent(doc.format)}/${encodeURIComponent(doc.docNumber)}${doc.year ? `?year=${doc.year}` : ''}`}
      onMouseEnter={start}
      onMouseLeave={cancel}
      onFocus={start}
      onBlur={cancel}
      className="font-mono text-xs text-primary transition-colors hover:underline hover:text-primary/80"
    >
      {doc.docNumber}
    </Link>
  )
}

/** The customer, linked when the ERP gave us a code — invagent only knows the name. */
function CustomerCell({ name, doc }: { name?: string | null; doc?: DocRef | null }) {
  const display = name || doc?.customerName
  if (doc?.customerCode) return <CustomerLink code={doc.customerCode} name={display} />
  return <span dir="auto">{display || '—'}</span>
}

/** Seconds as a person says them. Unknown stays unknown rather than becoming 0. */
function duration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—'
  if (seconds < 60) return `${seconds} שנ׳`
  if (seconds < 3600) return `${Math.round(seconds / 60)} דק׳`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return m ? `${h} שע׳ ${m} דק׳` : `${h} שע׳`
}

/**
 * Substring search over the fields a row can plausibly be looked up by.
 *
 * Deliberately not the rendered text: a document is shown as `128489` but the
 * warehouse says it out loud as `11128489`, and the customer is a link whose
 * text is not in the row at all. Both spellings of the number are searchable,
 * so whichever one someone has in front of them finds the row.
 */
function matches<T>(rows: T[], q: string, fields: (row: T) => Array<string | null | undefined>): T[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return rows
  return rows.filter(r => fields(r).some(v => v && String(v).toLowerCase().includes(needle)))
}

function TableSearch({ value, onChange, placeholder }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-8 w-56 rounded-md border bg-muted/40 ps-7 pe-2 text-xs outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  )
}

const QUEUE_COLUMNS: DataTableColumn<PickOrder>[] = [
  { key: 'document_number', header: 'תעודה', sortable: true,
    cell: o => <DocumentCell documentNumber={o.document_number} doc={o.doc} /> },
  { key: 'customer', header: 'לקוח', cell: o => <CustomerCell doc={o.doc} /> },
  { key: 'status', header: 'סטטוס', sortable: true, sortValue: o => statusRank(o.status),
    cell: o => statusLabel(o.status) },
  { key: 'priority', header: 'עדיפות', sortable: true, sortValue: o => priorityRank(o.priority),
    // The cell is a node for the hot priorities, and a node exports as nothing.
    exportValue: o => priorityLabel(o.priority),
    cell: o => (isHotPriority(o.priority)
      ? <span className="font-semibold text-destructive">{priorityLabel(o.priority)}</span>
      : <span>{priorityLabel(o.priority)}</span>) },
  { key: 'shipping_method', header: 'אופן משלוח', cell: o => o.shipping_method ?? '—' },
]

const DISPUTE_COLUMNS: DataTableColumn<DisputeGroup>[] = [
  { key: 'sku', header: 'מק״ט', sortable: true,
    cell: d => <ItemLink code={d.sku} name={d.description} showCode /> },
  { key: 'description', header: 'תיאור',
    cell: d => (d.description ? <ItemLink code={d.sku} name={d.description} /> : '—') },
  // The count is the whole point: one shortage is a picker having a bad minute,
  // a repeat is a shelf whose count is wrong. Default sort keeps repeats on top.
  { key: 'times', header: 'פעמים', sortable: true, cell: d => String(d.times) },
  { key: 'quantityShort', header: 'יח׳ חסרות', sortable: true, cell: d => formatNumber(d.quantityShort) },
  { key: 'labelLocation', header: 'מדף במדבקה', cell: d => d.labelLocation ?? '—' },
  // Deduped AFTER mapping: `Can't find` and `Cannot locate` are one reason in
  // Hebrew, and grouping upstream happened on the raw strings, so a part short
  // under both spellings would otherwise read "לא נמצא במדף, לא נמצא במדף".
  { key: 'reasons', header: 'סיבה',
    cell: d => [...new Set(d.reasons.map(reasonLabel))].join(', ') || '—' },
]

const SHIPPED_COLUMNS: DataTableColumn<ShippedOrder>[] = [
  { key: 'document_number', header: 'תעודה', sortable: true,
    cell: o => <DocumentCell documentNumber={o.document_number} doc={o.doc} /> },
  { key: 'customer_name', header: 'לקוח',
    cell: o => <CustomerCell name={o.customer_name} doc={o.doc} /> },
  { key: 'items_count', header: 'שורות', sortable: true, cell: o => String(o.items_count) },
  { key: 'total_quantity', header: 'יח׳', sortable: true, cell: o => formatNumber(o.total_quantity) },
  { key: 'pick_duration_seconds', header: 'זמן ליקוט', sortable: true,
    cell: o => duration(o.pick_duration_seconds) },
]

export default function PickingPage() {
  const { data, isLoading, isError, error, refetch } = usePicking()

  const [queueQuery, setQueueQuery] = useState('')
  const [shippedQuery, setShippedQuery] = useState('')

  const disputes = data?.disputes
  const shipped = data?.shipped

  const queueRows = useMemo(
    () => matches(data?.queue ?? [], queueQuery, o =>
      [o.document_number, o.doc?.docNumber, o.doc?.customerName,
       o.status, statusLabel(o.status), o.priority, priorityLabel(o.priority), o.shipping_method]),
    [data?.queue, queueQuery],
  )
  const shippedRows = useMemo(
    () => matches(shipped?.orders ?? [], shippedQuery, o =>
      [o.document_number, o.doc?.docNumber, o.customer_name, o.doc?.customerName, o.shipping_method]),
    [shipped?.orders, shippedQuery],
  )
  // The queue is fetched with a cap, so its length is a floor. "50" reads as the
  // whole floor; "+50" says there is more behind it.
  const queueCount = data ? `${formatNumber(data.queue.length)}${data.queueCapped ? '+' : ''}` : '—'

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        icon={PackageSearch}
        title="ליקוט במחסן"
        description={
          data
            ? `${queueCount} הזמנות בליקוט · ${formatNumber(disputes?.bySku.length ?? 0)} מק״טים לא נמצאו במדף`
            : 'מה נמצא כרגע על רצפת המחסן — בין המדף לנהג'
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">בליקוט כרגע</div>
            <div className="text-2xl font-bold tabular-nums">{queueCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">לא נמצאו במדף</div>
            <div className="text-2xl font-bold tabular-nums text-destructive">
              {disputes ? formatNumber(disputes.bySku.length) : '—'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">זמן ליקוט ממוצע</div>
            <div className="text-2xl font-bold tabular-nums">
              {duration(shipped?.avgPickSeconds ?? null)}
            </div>
            {/* The denominator, on the card. Without it a mean over 3 of 90
                orders reads as the day's number. */}
            <div className="text-[11px] text-muted-foreground">
              {shipped ? `מתוך ${formatNumber(shipped.timedOrders)} הזמנות שנמדדו` : ' '}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            פריטים שלא נמצאו במדף
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            שורות שהמלקט סימן כלא זמינות. מק״ט שחוזר כאן יותר מפעם אחת — כדאי לספור את המדף שלו:
            המלאי במערכת רשום, ובפועל לא נמצא.
          </p>
          <DataTable
            rows={disputes?.bySku ?? []}
            columns={DISPUTE_COLUMNS}
            getRowKey={d => d.sku}
            loading={isLoading}
            error={isError ? (error as Error)?.message : undefined}
            onRetry={() => refetch()}
            defaultSort={{ field: 'times', dir: 'desc' }}
            exportFileName="לא-נמצאו-במדף"
            minWidth="min-w-[640px]"
            pageSize={25}
            labels={{ empty: 'לא דווחו פריטים חסרים במדף' }}
            mobileCard={{
              title: d => d.sku,
              subtitle: d => d.description,
              accent: d => `${d.times} פעמים`,
              fields: [{ label: 'יח׳ חסרות', value: d => String(d.quantityShort) }],
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="mb-2 text-sm font-semibold">תור הליקוט</div>
          <DataTable
            rows={queueRows}
            columns={QUEUE_COLUMNS}
            getRowKey={o => o.document_number}
            loading={isLoading}
            error={isError ? (error as Error)?.message : undefined}
            onRetry={() => refetch()}
            exportFileName="תור-ליקוט"
            minWidth="min-w-[680px]"
            pageSize={25}
            toolbar={
              <TableSearch value={queueQuery} onChange={setQueueQuery} placeholder="חיפוש תעודה, לקוח, סטטוס…" />
            }
            // Under a search, "there are no orders in picking" is a different
            // claim from "nothing matched", and the floor may be full.
            labels={{ empty: queueQuery ? 'אין תוצאות לחיפוש' : 'אין כרגע הזמנות בליקוט' }}
            mobileCard={{
              title: o => o.document_number,
              subtitle: o => o.doc?.customerName || o.shipping_method || '—',
              accent: o => statusLabel(o.status),
              fields: [{ label: 'עדיפות', value: o => priorityLabel(o.priority) }],
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="mb-2 text-sm font-semibold">הזמנות שיצאו</div>
          <DataTable
            rows={shippedRows}
            columns={SHIPPED_COLUMNS}
            getRowKey={o => `${o.document_number}/${o.shipped_at}`}
            loading={isLoading}
            error={isError ? (error as Error)?.message : undefined}
            onRetry={() => refetch()}
            defaultSort={{ field: 'shipped_at', dir: 'desc' }}
            exportFileName="הזמנות-שיצאו"
            minWidth="min-w-[640px]"
            pageSize={25}
            toolbar={
              <TableSearch value={shippedQuery} onChange={setShippedQuery} placeholder="חיפוש תעודה, לקוח…" />
            }
            labels={{ empty: shippedQuery ? 'אין תוצאות לחיפוש' : 'לא נשלחו הזמנות בטווח הזה' }}
            mobileCard={{
              title: o => o.customer_name || o.document_number,
              subtitle: o => o.document_number,
              accent: o => duration(o.pick_duration_seconds),
              fields: [{ label: 'שורות', value: o => String(o.items_count) }],
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
