'use client'

import { Badge } from '@/components/ui/badge'
import { useLocale } from '@/lib/locale-context'
import type { TranslationKey } from '@/lib/i18n'

type Translate = (key: TranslationKey) => string
import { formatNumber, urgencyBand } from '@/lib/constants'
import { useSupplierDemand } from '@/hooks/use-suppliers'
import { TrendingDown, Loader2 } from 'lucide-react'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'

function getUrgencyBadge(score: number, t: Translate) {
  const band = urgencyBand(score)
  if (band === 'severe' || band === 'critical') return <Badge variant="destructive">{t('suppliers.critical')}</Badge>
  if (band === 'high') return <Badge variant="warning">{t('suppliers.high')}</Badge>
  if (band === 'watch') return <Badge variant="default">{t('suppliers.medium')}</Badge>
  return <Badge variant="secondary">{t('suppliers.low')}</Badge>
}

interface DemandItem {
  itemCode: string
  itemName: string
  currentStock: number
  avgMonthlySales: number
  suggestedQty: number
  urgencyScore: number
}

const COLUMNS = (t: Translate): DataTableColumn<DemandItem>[] => [
  {
    key: 'itemCode',
    header: t('suppliers.itemCode'),
    sortable: true,
    cell: i => i.itemCode,
    cellClassName: 'font-mono text-xs',
  },
  {
    key: 'itemName',
    header: t('suppliers.itemName'),
    sortable: true,
    truncate: 'max-w-[200px]',
    title: i => i.itemName,
    cell: i => i.itemName,
  },
  {
    key: 'currentStock',
    header: t('suppliers.currentStock'),
    align: 'end',
    sortable: true,
    // Zero stock is the row's whole point on a demand screen, so it stays red.
    cell: i => (
      <span className={i.currentStock === 0 ? 'font-semibold text-destructive' : undefined}>
        {formatNumber(i.currentStock)}
      </span>
    ),
    exportValue: i => i.currentStock,
  },
  {
    key: 'avgMonthlySales',
    header: t('suppliers.avgMonthlySales'),
    align: 'end',
    sortable: true,
    cell: i => formatNumber(i.avgMonthlySales),
    exportValue: i => i.avgMonthlySales,
  },
  {
    key: 'suggestedQty',
    header: t('suppliers.suggestedQty'),
    align: 'end',
    sortable: true,
    cell: i => formatNumber(i.suggestedQty),
    exportValue: i => i.suggestedQty,
    cellClassName: 'font-semibold',
  },
  {
    key: 'urgencyScore',
    header: t('suppliers.urgencyLevel'),
    align: 'center',
    sortable: true,
    cell: i => getUrgencyBadge(i.urgencyScore, t),
    // The badge is a node; export the score behind it.
    exportValue: i => i.urgencyScore,
  },
]

interface DemandForecastProps {
  supplierCode: string
}

export function DemandForecast({ supplierCode }: DemandForecastProps) {
  const { t } = useLocale()
  const { data, isLoading, isError } = useSupplierDemand(supplierCode)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>טוען תחזית...</span>
      </div>
    )
  }

  if (isError || !data?.items?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
        <TrendingDown className="h-6 w-6" />
        <span>{t('suppliers.noDemand')}</span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground mb-2">
        {data.count} {t('items')}
      </div>

      <DataTable
        rows={data.items as DemandItem[]}
        columns={COLUMNS(t)}
        getRowKey={(i, idx) => i.itemCode || String(idx)}
        defaultSort={{ field: 'urgencyScore', dir: 'desc' }}
        minWidth="min-w-[560px]"
        exportFileName={`demand-${supplierCode}`}
        pageSize={25}
        mobileCard={{
          title: i => i.itemName,
          subtitle: i => i.itemCode,
          accent: i => getUrgencyBadge(i.urgencyScore, t),
          fields: [
            { label: t('suppliers.currentStock'), value: i => formatNumber(i.currentStock) },
            { label: t('suppliers.suggestedQty'), value: i => formatNumber(i.suggestedQty) },
          ],
        }}
      />
    </div>
  )
}
