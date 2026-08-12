'use client'

import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useLocale } from '@/lib/locale-context'
import { formatNumber } from '@/lib/constants'
import { Card, CardContent } from '@/components/ui/card'
import { Loader2, TrendingDown } from 'lucide-react'

interface DemandItem {
  itemCode: string
  itemName: string
  purchasedQty: number
  orders: number
  lastOrder: string | null
  spend: number
  avgMonthlySales: number
  stockQty: number | null
  coverMonths: number | null
}
interface DemandResponse {
  items: DemandItem[]
  summary?: { items: number; totalSpend: number; noSales: number; lowCover: number }
  error?: string
}

/**
 * What we buy from this supplier, and how fast it moves. Rows are ordered by
 * quantity purchased; `coverMonths` (stock ÷ monthly sales) is the reorder
 * signal — low means running out, and "—" means no sales history to judge by
 * rather than a comfortable position.
 */
export default function SupplierDemandPage() {
  const { t } = useLocale()
  const { code } = useParams<{ code: string }>()

  const { data, isLoading } = useQuery<DemandResponse>({
    queryKey: ['supplier-demand', code],
    queryFn: async () => {
      const res = await fetch(`/api/suppliers/${encodeURIComponent(code)}/demand`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!code,
    staleTime: 5 * 60 * 1000,
  })

  const items = data?.items || []
  const summary = data?.summary

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t('suppliers.loadingDemand')}</span>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
        <TrendingDown className="h-6 w-6" />
        <span>{t('suppliers.noDemand')}</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: t('suppliers.itemsBought'), value: formatNumber(summary.items) },
            { label: t('suppliers.totalSpend'), value: `₪${formatNumber(Math.round(summary.totalSpend))}` },
            { label: t('suppliers.lowCover'), value: formatNumber(summary.lowCover), warn: summary.lowCover > 0 },
            { label: t('suppliers.noSales'), value: formatNumber(summary.noSales), warn: summary.noSales > 0 },
          ].map((k, i) => (
            <Card key={i}>
              <CardContent className="p-3 space-y-0.5">
                <div className="text-xs text-muted-foreground">{k.label}</div>
                <div className={`text-lg font-bold tabular-nums ${k.warn ? 'text-amber-500' : ''}`}>{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="rounded border overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.itemCode')}</th>
              <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.itemName')}</th>
              <th className="px-3 py-2 text-end text-xs font-medium">{t('suppliers.bought')}</th>
              <th className="px-3 py-2 text-end text-xs font-medium">{t('suppliers.soldPerMonth')}</th>
              <th className="px-3 py-2 text-end text-xs font-medium">{t('suppliers.stock')}</th>
              <th className="px-3 py-2 text-end text-xs font-medium">{t('suppliers.cover')}</th>
              <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.lastOrder')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.itemCode} className="border-t hover:bg-accent/50">
                <td className="px-3 py-2 font-mono text-xs">{i.itemCode}</td>
                <td className="px-3 py-2 truncate max-w-[240px]">{i.itemName}</td>
                <td className="px-3 py-2 text-end tabular-nums">{formatNumber(i.purchasedQty)}</td>
                <td className="px-3 py-2 text-end tabular-nums">{i.avgMonthlySales || '—'}</td>
                <td className="px-3 py-2 text-end tabular-nums">
                  {i.stockQty == null ? '—' : formatNumber(i.stockQty)}
                </td>
                <td className="px-3 py-2 text-end tabular-nums">
                  {i.coverMonths == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : i.coverMonths < 1 ? (
                    <span className="text-amber-500 font-semibold">{i.coverMonths}</span>
                  ) : (
                    i.coverMonths
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">{i.lastOrder?.slice(0, 10) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
