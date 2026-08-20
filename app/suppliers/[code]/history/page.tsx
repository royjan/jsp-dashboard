'use client'

import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useLocale } from '@/lib/locale-context'
import { formatNumber, formatCurrency } from '@/lib/constants'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Truck, Download, Eye } from 'lucide-react'
import { formatDate } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'

interface HistoryDoc {
  year: number
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
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

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
            { label: t('suppliers.totalValue'), value: formatCurrency(summary.totalValue) },
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

      {/* Bounded height makes THIS the scroll container, which is what a sticky
          thead latches onto — inside a plain overflow-x-auto wrapper the header
          has nothing to stick to. Background must be opaque (bg-muted/50 is
          translucent, so rows would show through the header as they scroll). */}
      <div className="rounded border overflow-auto max-h-[calc(100vh-22rem)]">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="sticky top-0 z-20 bg-card">
            <tr className="border-b">
              <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.shipmentDate')}</th>
              <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.docType')}</th>
              <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.docNumber')}</th>
              <th className="px-3 py-2 text-end text-xs font-medium">{t('suppliers.totalValue')}</th>
              <th className="px-3 py-2 text-center text-xs font-medium">{t('suppliers.document')}</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((d) => {
              const pdf = `/api/documents/${encodeURIComponent(d.format)}/${encodeURIComponent(d.docNumber)}/pdf?year=${d.year}`
              return (
                <tr key={`${d.format}-${d.docNumber}-${d.docDate}`} className="border-t hover:bg-accent/50">
                  <td className="px-3 py-2 tabular-nums whitespace-nowrap">{formatDate(d.docDate)}</td>
                  <td className="px-3 py-2">
                    <Badge variant={d.format === '58' ? 'secondary' : 'outline'} className="text-xs">
                      {isHe ? d.formatLabel.he : d.formatLabel.en}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{d.docNumber}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{formatCurrency(d.grandTotal)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-center gap-1">
                      {/* View opens the ERP's own rendering; download saves it. */}
                      <a href={pdf} target="_blank" rel="noopener noreferrer" title={t('suppliers.viewDoc')}
                         className="inline-flex items-center rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent">
                        <Eye className="h-3.5 w-3.5" />
                      </a>
                      <a href={`${pdf}&download=1`} title={t('suppliers.downloadDoc')}
                         className="inline-flex items-center rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent">
                        <Download className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
