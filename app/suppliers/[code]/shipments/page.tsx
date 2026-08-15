'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useLocale } from '@/lib/locale-context'
import { useSupplierShipments } from '@/hooks/use-suppliers'
import { formatNumber } from '@/lib/constants'
import { Loader2, Container } from 'lucide-react'
import { formatDate } from '@/lib/format'

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
    <div className="rounded border overflow-x-auto">
      <table className="w-full text-sm min-w-[560px]">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.shipmentDate')}</th>
            <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.shipmentName')}</th>
            <th className="px-3 py-2 text-end text-xs font-medium">{t('suppliers.scanned')}</th>
            <th className="px-3 py-2 text-end text-xs font-medium">{t('suppliers.missingQty')}</th>
            <th className="px-3 py-2 text-end text-xs font-medium">{t('suppliers.products')}</th>
          </tr>
        </thead>
        <tbody>
          {shipments.map((s) => (
            <tr key={s.id} className="border-t hover:bg-accent/50">
              <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                {formatDate(s.shipmentDate as string | null | undefined)}
              </td>
              <td className="px-3 py-2">
                <Link href={`/shipments/${encodeURIComponent(s.id)}`} className="hover:underline">
                  {s.name || s.id} ↗
                </Link>
              </td>
              <td className="px-3 py-2 text-end tabular-nums">
                {formatNumber(s.totalScanned)} / {formatNumber(s.totalExpected)}
              </td>
              <td className="px-3 py-2 text-end tabular-nums">
                {s.missing > 0
                  ? <span className="text-amber-500 font-semibold">{formatNumber(s.missing)}</span>
                  : <span className="text-muted-foreground">0</span>}
              </td>
              <td className="px-3 py-2 text-end tabular-nums">{formatNumber(s.uniqueProducts)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
