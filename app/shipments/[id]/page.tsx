'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import { formatNumber } from '@/lib/constants'
import { ItemLink } from '@/components/shared/ItemLink'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { ShipmentOrderCandidates } from '@/components/xpart/ShipmentOrderCandidates'
import { ArrowRight, ArrowLeft, AlertTriangle, PackageCheck, Container } from 'lucide-react'
import { formatDate } from '@/lib/format'

interface Product {
  part_id: string
  description: string
  location: string
  scanned: number
  total: number
  missing: number
  faulty: boolean
}
interface DetailResponse {
  shipment?: {
    id: string; name: string; supplier: string | null
    folder: string | null
    isInternal: boolean
    matchedSupplier: { code: string; name: string } | null
    shipmentDate: string
    createdAt: string | null
    totalScanned: number; totalExpected: number; missing: number; faulty: number; uniqueProducts: number
  }
  products: Product[]
  scanners?: { name: string; count: number }[]
  error?: string
}

export default function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { locale } = useLocale()
  const isHe = locale === 'he'
  const t = (he: string, en: string) => (isHe ? he : en)

  const { data, isLoading, error } = useQuery<DetailResponse>({
    queryKey: ['shipment', id],
    queryFn: async () => {
      const res = await fetch(`/api/shipments/${id}`)
      if (!res.ok && res.status !== 404) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  const sh = data?.shipment
  const products = data?.products ?? []

  const productColumns: DataTableColumn<Product>[] = [
    {
      key: 'part_id',
      header: t('קוד', 'Code'),
      sortable: true,
      cell: p => <ItemLink code={p.part_id} name={p.description} showCode />,
      exportValue: p => p.part_id,
    },
    {
      key: 'description',
      header: t('תיאור', 'Description'),
      sortable: true,
      truncate: 'max-w-[280px]',
      title: p => p.description,
      cell: p => (
        <>
          {p.description}
          {p.faulty && <Badge variant="destructive" className="ms-2 text-[10px]">{t('פגום', 'faulty')}</Badge>}
        </>
      ),
      exportValue: p => p.description,
    },
    {
      key: 'scanned',
      header: t('נסרק', 'Scanned'),
      align: 'end',
      sortable: true,
      cell: p => `${formatNumber(p.scanned)} / ${formatNumber(p.total)}`,
      exportValue: p => p.scanned,
    },
    {
      key: 'missing',
      header: t('חוסר', 'Missing'),
      align: 'end',
      sortable: true,
      cell: p =>
        p.missing > 0 ? (
          <span className="font-semibold text-amber-500">{formatNumber(p.missing)}</span>
        ) : (
          <span className="text-muted-foreground">0</span>
        ),
      exportValue: p => p.missing,
    },
  ]
  const BackIcon = isHe ? ArrowRight : ArrowLeft

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" className="gap-1" onClick={() => router.push('/shipments')}>
        <BackIcon className="h-4 w-4" />{t('חזרה למשלוחים', 'Back to shipments')}
      </Button>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : error || data?.error || !sh ? (
        <Card><CardContent className="py-10 text-center text-sm text-destructive">
          {t('המשלוח לא נמצא', 'Shipment not found')}{data?.error ? ` — ${data.error}` : ''}
        </CardContent></Card>
      ) : (
        <>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Container className="h-6 w-6 text-primary" />{sh.name || sh.id}
            </h1>
            <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
              {sh.isInternal ? (
                // Internal delivery — deliberately no supplier link.
                <Badge variant="secondary">{t('פנימי', 'Internal')}</Badge>
              ) : sh.matchedSupplier ? (
                <Link href={`/suppliers/${encodeURIComponent(sh.matchedSupplier.code)}`}>
                  <Badge variant="outline" className="cursor-pointer hover:bg-accent">
                    {t('ספק', 'Supplier')} {sh.supplier ? `${sh.supplier} · ` : ''}{sh.matchedSupplier.name} ↗
                  </Badge>
                </Link>
              ) : sh.supplier ? (
                <Link href={`/suppliers?q=${encodeURIComponent(sh.supplier)}`}>
                  <Badge variant="outline" className="cursor-pointer hover:bg-accent">{t('ספק', 'Supplier')} {sh.supplier} ↗</Badge>
                </Link>
              ) : (
                <Badge variant="outline">{t('ספק', 'Supplier')} —</Badge>
              )}
              <span>{formatDate(sh.shipmentDate as string | null | undefined)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: PackageCheck, label: t('נסרק / צפוי', 'Scanned / Expected'), value: `${formatNumber(sh.totalScanned)} / ${formatNumber(sh.totalExpected)}`, color: 'text-emerald-500' },
              { icon: AlertTriangle, label: t('חוסרים', 'Missing'), value: formatNumber(sh.missing), color: 'text-amber-500' },
              { icon: AlertTriangle, label: t('פגומים', 'Faulty'), value: formatNumber(sh.faulty), color: 'text-red-500' },
              { icon: Container, label: t('פריטים', 'Products'), value: formatNumber(sh.uniqueProducts), color: 'text-blue-500' },
            ].map((k, i) => (
              <Card key={i}><CardContent className="p-4 space-y-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground"><k.icon className={`h-4 w-4 ${k.color}`} />{k.label}</div>
                <p className="text-lg sm:text-xl font-bold">{k.value}</p>
              </CardContent></Card>
            ))}
          </div>

          {data?.scanners && data.scanners.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">{t('נסרק ע״י', 'Scanned by')}:</span>
              {data.scanners.slice(0, 8).map((s) => (
                <Badge key={s.name} variant="secondary">{s.name} · {formatNumber(s.count)}</Badge>
              ))}
            </div>
          )}

          {/* Which PO did this come from? The two systems share no key, so this
              is the supplier's orders that predate the scan, for a human to pick. */}
          <ShipmentOrderCandidates
            supplierCode={sh.matchedSupplier?.code}
            arrivedOn={sh.shipmentDate}
            isHe={isHe}
          />

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t('פריטים', 'Products')} ({formatNumber(products.length)})</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                <DataTable<Product>
                  rows={products}
                  columns={productColumns}
                  getRowKey={p => p.part_id}
                  minWidth="min-w-[640px]"
                  maxHeight="none"
                  exportFileName={`משלוח-${id}`}
                  // A faulty line is the reason someone opens this screen, so it
                  // stays marked wherever the sort puts it.
                  rowClassName={p => (p.faulty ? 'bg-red-500/5' : undefined)}
                  mobileCard={{
                    title: p => p.description,
                    subtitle: p => p.part_id,
                    accent: p => `${formatNumber(p.scanned)} / ${formatNumber(p.total)}`,
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
