'use client'

import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useLocale } from '@/lib/locale-context'
import { formatNumber } from '@/lib/constants'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Truck } from 'lucide-react'

interface HistoryDoc {
  format: string
  formatLabel: { he: string; en: string }
  docNumber: string
  docDate: string | null
  status: string
  grandTotal: number
}
interface HistoryResponse {
  documents: HistoryDoc[]
  summary?: { documents: number; deliveryNotes: number; invoices: number; totalValue: number; lastDocument: string | null }
  error?: string
}

/**
 * Real purchase history from the ERP. This view previously read
 * `supplier_order_confirmations`, a manual table that is empty for every
 * supplier — so it showed "no deliveries" regardless of how much we had
 * actually bought.
 */
export default function SupplierHistoryPage() {
  const { t, locale } = useLocale()
  const { code } = useParams<{ code: string }>()
  const isHe = locale === 'he'

  const { data, isLoading } = useQuery<HistoryResponse>({
    queryKey: ['supplier-history', code],
    queryFn: async () => {
      const res = await fetch(`/api/suppliers/${encodeURIComponent(code)}/history`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!code,
    staleTime: 5 * 60 * 1000,
  })

  const documents = data?.documents || []
  const summary = data?.summary

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t('suppliers.loadingHistory')}</span>
      </div>
    )
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
        <Truck className="h-6 w-6" />
        <span>{t('suppliers.noDeliveries')}</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: t('suppliers.documents'), value: formatNumber(summary.documents) },
            { label: t('suppliers.deliveryNotes'), value: formatNumber(summary.deliveryNotes) },
            { label: t('suppliers.invoices'), value: formatNumber(summary.invoices) },
            { label: t('suppliers.totalValue'), value: `₪${formatNumber(Math.round(summary.totalValue))}` },
          ].map((k, i) => (
            <Card key={i}>
              <CardContent className="p-3 space-y-0.5">
                <div className="text-xs text-muted-foreground">{k.label}</div>
                <div className="text-lg font-bold tabular-nums">{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="rounded border overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.shipmentDate')}</th>
              <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.docType')}</th>
              <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.docNumber')}</th>
              <th className="px-3 py-2 text-end text-xs font-medium">{t('suppliers.totalValue')}</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => (
              <tr key={`${d.format}-${d.docNumber}-${d.docDate}`} className="border-t hover:bg-accent/50">
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">{d.docDate?.slice(0, 10) || '—'}</td>
                <td className="px-3 py-2">
                  <Badge variant={d.format === '58' ? 'secondary' : 'outline'} className="text-xs">
                    {isHe ? d.formatLabel.he : d.formatLabel.en}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{d.docNumber}</td>
                <td className="px-3 py-2 text-end tabular-nums">₪{formatNumber(Math.round(d.grandTotal))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
