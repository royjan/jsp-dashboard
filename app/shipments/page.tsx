'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import { formatNumber } from '@/lib/constants'
import { useSortable, SortableTh } from '@/components/shared/sortable-table'
import { Container, PackageCheck, AlertTriangle, Truck, ChevronLeft, ChevronRight} from 'lucide-react'

interface Shipment {
  id: string
  name: string
  supplier: string | null
  shipmentDate: string
  totalScanned: number
  totalExpected: number
  missing: number
  faulty: number
  uniqueProducts: number
}
interface ShipmentsResponse {
  shipments: Shipment[]
  hasMore: boolean
  offset: number
  limit: number
  summary: { total: number; suppliers: number; totalScanned: number; missing: number } | null
  error?: string
}

const PAGE = 30

export default function ShipmentsPage() {
  const router = useRouter()
  const { locale } = useLocale()
  const isHe = locale === 'he'
  const t = (he: string, en: string) => (isHe ? he : en)
  const [offset, setOffset] = useState(0)

  const { data, isLoading, isFetching, error } = useQuery<ShipmentsResponse>({
    queryKey: ['inbound-shipments', offset],
    queryFn: async () => {
      const res = await fetch(`/api/shipments?limit=${PAGE}&offset=${offset}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  })

  const fmtDate = (s: string) => (s ? s.slice(0, 10) : '—')
  const summary = data?.summary
  const { sorted, sortKey, sortDir, toggleSort } = useSortable<Shipment>(data?.shipments ?? [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Container className="h-6 w-6 text-primary" />
          {t('משלוחים נכנסים', 'Inbound Shipments')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('סחורה שמגיעה מספקים אל ג׳אן', 'Goods arriving from suppliers to Jan')}</p>
      </div>

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
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">{t('משלוחים אחרונים', 'Recent shipments')}</CardTitle>
          <span className="text-xs text-muted-foreground tabular-nums">
            {offset + 1}–{offset + (data?.shipments?.length ?? 0)}{isFetching ? ' …' : ''}
          </span>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : error || data?.error ? (
            <div className="py-10 text-center text-sm text-destructive">
              {t('שגיאה בטעינת המשלוחים', 'Failed to load shipments')}{data?.error ? ` — ${data.error}` : ''}
            </div>
          ) : sorted.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">{t('אין משלוחים', 'No shipments')}</div>
          ) : (
            <>
              <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                <table className="w-full text-xs sm:text-sm min-w-[680px]">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <SortableTh<Shipment> label={t('תאריך', 'Date')} sortKey="shipmentDate" align="start" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh<Shipment> label={t('ספק', 'Supplier')} sortKey="supplier" align="start" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh<Shipment> label={t('משלוח', 'Shipment')} sortKey="name" align="start" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh<Shipment> label={t('נסרק', 'Scanned')} sortKey="totalScanned" align="end" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh<Shipment> label={t('חוסר', 'Missing')} sortKey="missing" align="end" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                      <SortableTh<Shipment> label={t('פריטים', 'Products')} sortKey="uniqueProducts" align="end" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((s) => (
                      <tr
                        key={s.id}
                        onClick={() => router.push(`/shipments/${s.id}`)}
                        className="border-b last:border-0 hover:bg-accent/50 cursor-pointer"
                      >
                        <td className="p-2 tabular-nums whitespace-nowrap">{fmtDate(s.shipmentDate)}</td>
                        <td className="p-2"><Badge variant="outline">{s.supplier || '—'}</Badge></td>
                        <td className="p-2 truncate max-w-[260px]">{s.name}</td>
                        <td className="p-2 text-end tabular-nums">{formatNumber(s.totalScanned)} / {formatNumber(s.totalExpected)}</td>
                        <td className="p-2 text-end tabular-nums">
                          {s.missing > 0 ? <span className="text-amber-500 font-semibold">{formatNumber(s.missing)}</span> : <span className="text-muted-foreground">0</span>}
                        </td>
                        <td className="p-2 text-end tabular-nums">{formatNumber(s.uniqueProducts)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
