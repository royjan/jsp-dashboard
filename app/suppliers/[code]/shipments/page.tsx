'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useLocale } from '@/lib/locale-context'
import { useSupplierShipments } from '@/hooks/use-suppliers'
import { formatNumber } from '@/lib/constants'
import { Loader2, Container } from 'lucide-react'
import { formatDate } from '@/lib/format'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import type { TranslationKey } from '@/lib/i18n'

type Translate = (key: TranslationKey) => string
type Shipment = NonNullable<ReturnType<typeof useSupplierShipments>['data']>['shipments'][number]

const COLUMNS = (t: Translate): DataTableColumn<Shipment>[] => [
  {
    key: 'shipmentDate',
    header: t('suppliers.shipmentDate'),
    sortable: true,
    cell: s => formatDate(s.shipmentDate as string | null | undefined),
    exportValue: s => (s.shipmentDate as string | null) ?? null,
    cellClassName: 'tabular-nums whitespace-nowrap',
  },
  {
    key: 'name',
    header: t('suppliers.shipmentName'),
    sortable: true,
    cell: s => (
      <Link href={`/shipments/${encodeURIComponent(s.id)}`} className="hover:underline">
        {s.name || s.id} ↗
      </Link>
    ),
    exportValue: s => s.name || s.id,
  },
  {
    key: 'totalScanned',
    header: t('suppliers.scanned'),
    align: 'end',
    sortable: true,
    cell: s => `${formatNumber(s.totalScanned)} / ${formatNumber(s.totalExpected)}`,
    // "12 / 15" is one cell to read and two numbers to sum; split it for export.
    exportValue: s => s.totalScanned,
    exportHeader: t('suppliers.scanned'),
  },
  {
    key: 'missing',
    header: t('suppliers.missingQty'),
    align: 'end',
    sortable: true,
    cell: s =>
      s.missing > 0
        ? <span className="font-semibold text-amber-500">{formatNumber(s.missing)}</span>
        : <span className="text-muted-foreground">0</span>,
    exportValue: s => s.missing,
  },
  {
    key: 'uniqueProducts',
    header: t('suppliers.products'),
    align: 'end',
    sortable: true,
    cell: s => formatNumber(s.uniqueProducts),
    exportValue: s => s.uniqueProducts,
  },
]

/**
 * Warehouse receiving for this supplier. Distinct from "delivery history",
 * which is ERP purchase documents — this is what was physically scanned in.
 */
export default function SupplierShipmentsPage() {
  const { t } = useLocale()
  const { code } = useParams<{ code: string }>()
  const { data, isLoading } = useSupplierShipments(code)
  const shipments = data?.shipments || []

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t('suppliers.loadingShipments')}</span>
      </div>
    )
  }

  if (shipments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
        <Container className="h-6 w-6" />
        <span>{t('suppliers.noShipments')}</span>
      </div>
    )
  }

  return (
    <DataTable
      rows={shipments}
      columns={COLUMNS(t)}
      getRowKey={s => s.id}
      defaultSort={{ field: 'shipmentDate', dir: 'desc' }}
      minWidth="min-w-[560px]"
      pageSize={25}
      exportFileName={`shipments-${code}`}
      mobileCard={{
        title: s => s.name || s.id,
        subtitle: s => formatDate(s.shipmentDate as string | null | undefined),
        accent: s => `${formatNumber(s.totalScanned)}/${formatNumber(s.totalExpected)}`,
        fields: [{ label: t('suppliers.missingQty'), value: s => formatNumber(s.missing) }],
      }}
    />
  )
}
