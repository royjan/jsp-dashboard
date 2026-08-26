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
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import type { TranslationKey } from '@/lib/i18n'

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
type Translate = (key: TranslationKey) => string

const HISTORY_COLUMNS = (t: Translate, isHe: boolean): DataTableColumn<HistoryDoc>[] => [
  { key: 'docDate', header: t('suppliers.shipmentDate'), sortable: true,
    cell: d => formatDate(d.docDate), exportValue: d => d.docDate,
    cellClassName: 'tabular-nums whitespace-nowrap' },
  { key: 'formatLabel', header: t('suppliers.docType'), sortable: true,
    cell: d => (
      <Badge variant={d.format === '58' ? 'secondary' : 'outline'} className="text-xs">
        {isHe ? d.formatLabel.he : d.formatLabel.en}
      </Badge>
    ),
    exportValue: d => (isHe ? d.formatLabel.he : d.formatLabel.en),
    sortValue: d => (isHe ? d.formatLabel.he : d.formatLabel.en) },
  { key: 'docNumber', header: t('suppliers.docNumber'), sortable: true,
    cell: d => d.docNumber, exportValue: d => d.docNumber, cellClassName: 'font-mono text-xs' },
  { key: 'grandTotal', header: t('suppliers.totalValue'), align: 'end', sortable: true,
    cell: d => formatCurrency(d.grandTotal), exportValue: d => d.grandTotal },
  {
    key: 'document',
    header: t('suppliers.document'),
    align: 'center',
    // Row actions, not data — excluded from the export rather than written as
    // an empty column.
    exportValue: null,
    cell: d => {
      const pdf = `/api/documents/${encodeURIComponent(d.format)}/${encodeURIComponent(d.docNumber)}/pdf?year=${d.year}`
      return (
        <div className="flex items-center justify-center gap-1">
          {/* View opens the ERP's own rendering; download saves it. */}
          <a href={pdf} target="_blank" rel="noopener noreferrer" title={t('suppliers.viewDoc')}
             className="inline-flex items-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <Eye className="h-3.5 w-3.5" />
          </a>
          <a href={`${pdf}&download=1`} title={t('suppliers.downloadDoc')}
             className="inline-flex items-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <Download className="h-3.5 w-3.5" />
          </a>
        </div>
      )
    },
  },
]

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

      <DataTable
        rows={documents}
        columns={HISTORY_COLUMNS(t, isHe)}
        getRowKey={d => `${d.format}-${d.docNumber}-${d.docDate}`}
        defaultSort={{ field: 'docDate', dir: 'desc' }}
        minWidth="min-w-[560px]"
        pageSize={25}
        exportFileName={`supplier-history-${code}`}
        mobileCard={{
          title: d => (isHe ? d.formatLabel.he : d.formatLabel.en),
          subtitle: d => `${d.docNumber} · ${formatDate(d.docDate)}`,
          accent: d => formatCurrency(d.grandTotal),
        }}
      />
    </div>
  )
}
