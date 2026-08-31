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

import Link from 'next/link'
import { PackageSearch, AlertTriangle } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { ItemLink } from '@/components/shared/ItemLink'
import { CustomerLink } from '@/components/shared/CustomerLink'
import { formatNumber } from '@/lib/format'
import { usePicking, type PickOrder, type DisputeGroup, type ShippedOrder, type DocRef } from '@/hooks/use-picking'

/**
 * The document, where the rest of the dashboard already knows how to show it.
 *
 * Unresolved rows stay plain text rather than becoming a link to a guessed
 * format — /documents/[format]/[number] would happily render somebody else's
 * document under this order's number.
 */
function DocumentCell({ documentNumber, doc }: { documentNumber: string; doc?: DocRef | null }) {
  if (!doc) return <span className="font-mono text-xs">{documentNumber}</span>
  return (
    <Link
      href={`/documents/${encodeURIComponent(doc.format)}/${encodeURIComponent(doc.docNumber)}${doc.year ? `?year=${doc.year}` : ''}`}
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

const QUEUE_COLUMNS: DataTableColumn<PickOrder>[] = [
  { key: 'document_number', header: 'תעודה', sortable: true,
    cell: o => <DocumentCell documentNumber={o.document_number} doc={o.doc} /> },
  { key: 'customer', header: 'לקוח', cell: o => <CustomerCell doc={o.doc} /> },
  { key: 'status', header: 'סטטוס', sortable: true, cell: o => o.status },
  { key: 'priority', header: 'עדיפות', sortable: true,
    cell: o => (['urgent', 'high'].includes(String(o.priority).toLowerCase())
      ? <span className="font-semibold text-destructive">{o.priority}</span>
      : <span>{o.priority}</span>) },
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
  { key: 'reasons', header: 'סיבה', cell: d => d.reasons.join(', ') || '—' },
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

  const disputes = data?.disputes
  const shipped = data?.shipped
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
            rows={data?.queue ?? []}
            columns={QUEUE_COLUMNS}
            getRowKey={o => o.document_number}
            loading={isLoading}
            error={isError ? (error as Error)?.message : undefined}
            onRetry={() => refetch()}
            exportFileName="תור-ליקוט"
            minWidth="min-w-[680px]"
            pageSize={25}
            labels={{ empty: 'אין כרגע הזמנות בליקוט' }}
            mobileCard={{
              title: o => o.document_number,
              subtitle: o => o.doc?.customerName || o.shipping_method || '—',
              accent: o => o.status,
              fields: [{ label: 'עדיפות', value: o => o.priority }],
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="mb-2 text-sm font-semibold">הזמנות שיצאו</div>
          <DataTable
            rows={shipped?.orders ?? []}
            columns={SHIPPED_COLUMNS}
            getRowKey={o => `${o.document_number}/${o.shipped_at}`}
            loading={isLoading}
            error={isError ? (error as Error)?.message : undefined}
            onRetry={() => refetch()}
            defaultSort={{ field: 'shipped_at', dir: 'desc' }}
            exportFileName="הזמנות-שיצאו"
            minWidth="min-w-[640px]"
            pageSize={25}
            labels={{ empty: 'לא נשלחו הזמנות בטווח הזה' }}
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
