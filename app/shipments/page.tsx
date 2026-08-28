'use client'

import { useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import { formatNumber } from '@/lib/constants'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { Container, PackageCheck, AlertTriangle, Truck, ChevronLeft, ChevronRight} from 'lucide-react'
import { formatDate } from '@/lib/format'
import { PageHeader } from '@/components/shared/PageHeader'
import { SubTabs } from '@/components/shared/SubTabs'

interface Shipment {
  id: string
  name: string
  supplier: string | null
  folder: string | null
  isInternal: boolean
  matchedSupplier: { code: string; name: string } | null
  shipmentDate: string
  createdAt: string | null
  totalScanned: number
  totalExpected: number
  missing: number
  faulty: number
  uniqueProducts: number
}
interface SupplierRollup {
  supplier: string
  name: string
  count: number
  latest: string
}
interface ShipmentsResponse {
  shipments: Shipment[]
  suppliers?: SupplierRollup[]
  internalCount?: number
  unfilteredTotal?: number
  hasMore: boolean
  offset: number
  limit: number
  total?: number
  summary: { total: number; suppliers: number; totalScanned: number; missing: number } | null
  error?: string
}

const PAGE = 30

export default function ShipmentsPage() {
  const router = useRouter()
  const { locale } = useLocale()
  const isHe = locale === 'he'
  // Stable identity: the column memo below depends on `t`, and DataTable
  // re-sorts whenever `columns` changes — an inline arrow here would rebuild
  // the columns and re-sort on every render.
  const t = useCallback((he: string, en: string) => (isHe ? he : en), [isHe])
  const [offset, setOffset] = useState(0)
  // '' = everything, 'internal' = the internal receiving stream, otherwise a supplier code.
  const [filter, setFilter] = useState('')

  // Changing the filter re-pages from the top; keeping the old offset would
  // land past the end of a smaller result set and show an empty table.
  const selectFilter = (next: string) => {
    setFilter(next)
    setOffset(0)
  }

  const { data, isLoading, isFetching, error } = useQuery<ShipmentsResponse>({
    queryKey: ['inbound-shipments', offset, filter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
      if (filter === 'internal') params.set('internal', '1')
      else if (filter) params.set('supplier', filter)
      const res = await fetch(`/api/shipments?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  })

  // The API normalises Firestore's mixed string/Timestamp dates to ISO, but
  // stay defensive: a non-string here used to throw on .slice and blank the page.
  const fmtDate = (s: unknown) => formatDate(s as string | null | undefined)
  const summary = data?.summary
  // Both are computed server-side over the unfiltered set, so the chips keep
  // their labels and counts while a filter is active.
  const supplierOptions = data?.suppliers ?? []
  const internalCount = data?.internalCount ?? 0
  // Sorting moved into <DataTable> (uncontrolled, shared comparator). No
  // defaultSort: rows keep the API's order until a header is clicked, which is
  // what useSortable did with no initial key.
  const rows = data?.shipments ?? []

  const columns = useMemo<DataTableColumn<Shipment>[]>(() => [
    { key: 'shipmentDate', header: t('תאריך', 'Date'), sortable: true, cellClassName: 'whitespace-nowrap', cell: (s: Shipment) => fmtDate(s.shipmentDate) },
    {
      key: 'supplier', header: t('ספק', 'Supplier'), sortable: true,
      cell: (s: Shipment) => s.isInternal ? (
        // Not a supplier at all — an internal delivery.
        <Badge variant="secondary">{t('פנימי', 'Internal')}</Badge>
      ) : s.matchedSupplier ? (
        <Link href={`/suppliers/${encodeURIComponent(s.matchedSupplier.code)}`} onClick={(e) => e.stopPropagation()}>
          <Badge variant="outline" className="max-w-[200px] cursor-pointer truncate hover:bg-accent">
            {s.supplier ? `${s.supplier} · ` : ''}{s.matchedSupplier.name} ↗
          </Badge>
        </Link>
      ) : (
        <Badge variant="outline">{s.supplier || '—'}</Badge>
      ),
    },
    { key: 'name', header: t('משלוח', 'Shipment'), sortable: true, truncate: 'max-w-[260px]', title: (s: Shipment) => s.name, cell: (s: Shipment) => s.name },
    { key: 'totalScanned', header: t('נסרק', 'Scanned'), align: 'end', sortable: true, cell: (s: Shipment) => `${formatNumber(s.totalScanned)} / ${formatNumber(s.totalExpected)}` },
    {
      key: 'missing', header: t('חוסר', 'Missing'), align: 'end', sortable: true,
      cell: (s: Shipment) => s.missing > 0
        ? <span className="font-semibold text-amber-500">{formatNumber(s.missing)}</span>
        : <span className="text-muted-foreground">0</span>,
    },
    { key: 'uniqueProducts', header: t('פריטים', 'Products'), align: 'end', sortable: true, cell: (s: Shipment) => formatNumber(s.uniqueProducts) },
  ], [t])

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Container}
        title={t('משלוחים', 'Shipments')}
        description={t('סחורה שנסרקה במחסן · מתוך אפליקציית הסריקה', 'Goods scanned at the warehouse · from the scanning app')}
      />

      {/* Ordered → arrived. This page starts at the moment a carton is scanned;
          the tab beside it covers the weeks before that, from Xpart's purchase
          orders. Same journey, two systems, so they are tabs rather than one
          table pretending the rows are the same kind of thing. */}
      <SubTabs
        tabs={[
          { href: '/shipments/on-the-way', label: t('בדרך', 'On the way') },
          { href: '/shipments', label: t('התקבל במחסן', 'Received') },
        ]}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: Container, label: t('משלוחים (עמוד)', 'Shipments (page)'), value: formatNumber(summary?.total ?? 0), color: 'text-blue-500' },
          { icon: Truck, label: t('ספקים', 'Suppliers'), value: formatNumber(summary?.suppliers ?? 0), color: 'text-violet-500' },
          { icon: PackageCheck, label: t('פריטים נסרקו', 'Items scanned'), value: formatNumber(summary?.totalScanned ?? 0), color: 'text-emerald-500' },
          { icon: AlertTriangle, label: t('חוסרים', 'Missing'), value: formatNumber(summary?.missing ?? 0), color: 'text-amber-500' },
        ].map((kpi, i) => (
          <Card key={i}>
            <CardContent className="p-4 space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <kpi.icon className={`h-4 w-4 ${kpi.color}`} />{kpi.label}
              </div>
              <p className="text-xl sm:text-2xl font-bold">{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2 space-y-2">
          <div className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">{t('משלוחים אחרונים', 'Recent shipments')}</CardTitle>
            <span className="text-xs text-muted-foreground tabular-nums">
              {offset + 1}–{offset + (data?.shipments?.length ?? 0)}
              {data?.total != null ? ` / ${formatNumber(data.total)}` : ''}{isFetching ? ' …' : ''}
            </span>
          </div>
          {/* Filter by supplier. The options come from the API's roll-up over
              the whole set (not the page), so they stay put once one is
              picked. Internal deliveries have no supplier and no sender label
              — one chip for the whole stream, filtered by `internal=1`. */}
          {(supplierOptions.length > 0 || internalCount > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant={filter === '' ? 'default' : 'outline'}
                className="h-7 text-xs"
                onClick={() => selectFilter('')}
              >
                {t('הכל', 'All')}
                {data?.unfilteredTotal != null && (
                  <span className="ms-1 opacity-70 tabular-nums">{formatNumber(data.unfilteredTotal)}</span>
                )}
              </Button>
              {supplierOptions.map((s) => (
                <Button
                  key={s.supplier}
                  size="sm"
                  variant={filter === s.supplier ? 'default' : 'outline'}
                  className="h-7 text-xs max-w-[220px]"
                  onClick={() => selectFilter(s.supplier)}
                  title={s.name}
                >
                  <span className="truncate">{s.name}</span>
                  <span className="ms-1 opacity-70 tabular-nums">{formatNumber(s.count)}</span>
                </Button>
              ))}
              {internalCount > 0 && (
                <Button
                  size="sm"
                  variant={filter === 'internal' ? 'secondary' : 'outline'}
                  className="h-7 text-xs"
                  onClick={() => selectFilter('internal')}
                >
                  <span>{t('פנימי', 'Internal')}</span>
                  <span className="ms-1 opacity-70 tabular-nums">{formatNumber(internalCount)}</span>
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : error || data?.error ? (
            <div className="py-10 text-center text-sm text-destructive">
              {t('שגיאה בטעינת המשלוחים', 'Failed to load shipments')}{data?.error ? ` — ${data.error}` : ''}
            </div>
          ) : (
            /* No empty branch here: DataTable renders its own empty state, and
               short-circuiting on it hid the pagination controls — leaving an
               empty page with no way back. */
            <>
              {/* Bounded height so this is the scroll container the sticky
                  header can latch onto (see stock-forecast for the rationale). */}
              <DataTable
                rows={rows}
                columns={columns}
                getRowKey={(s: Shipment) => s.id}
                onRowClick={(s: Shipment) => router.push(`/shipments/${s.id}`)}
                minWidth="min-w-[680px]"
                maxHeight="calc(100vh - 20rem)"
                labels={{ empty: t('אין משלוחים', 'No shipments') }}
              />
              {/* Pagination */}
              <div className="mt-3 flex items-center justify-between">
                <Button variant="outline" size="sm" disabled={offset === 0 || isFetching} onClick={() => setOffset((o) => Math.max(0, o - PAGE))}>
                  <ChevronRight className="h-4 w-4 sm:hidden" /><ChevronLeft className="h-4 w-4 hidden sm:block" />{t('הקודם', 'Prev')}
                </Button>
                <span className="text-xs text-muted-foreground">{t('עמוד', 'Page')} {Math.floor(offset / PAGE) + 1}</span>
                <Button variant="outline" size="sm" disabled={!data?.hasMore || isFetching} onClick={() => setOffset((o) => o + PAGE)}>
                  {t('הבא', 'Next')}<ChevronLeft className="h-4 w-4 sm:hidden" /><ChevronRight className="h-4 w-4 hidden sm:block" />
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
