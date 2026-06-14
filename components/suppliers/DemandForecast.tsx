'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useLocale } from '@/lib/locale-context'
import { useSupplierDemand } from '@/hooks/use-suppliers'
import { TrendingDown, AlertTriangle, Loader2 } from 'lucide-react'

function getUrgencyBadge(score: number, t: (key: any) => string) {
  if (score >= 20) return <Badge variant="destructive">{t('suppliers.critical')}</Badge>
  if (score >= 10) return <Badge variant="warning">{t('suppliers.high')}</Badge>
  if (score >= 5) return <Badge variant="default">{t('suppliers.medium')}</Badge>
  return <Badge variant="secondary">{t('suppliers.low')}</Badge>
}

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

      <div className="rounded border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.itemCode')}</th>
              <th className="px-3 py-2 text-start text-xs font-medium">{t('suppliers.itemName')}</th>
              <th className="px-3 py-2 text-end text-xs font-medium">{t('suppliers.currentStock')}</th>
              <th className="px-3 py-2 text-end text-xs font-medium">{t('suppliers.avgMonthlySales')}</th>
              <th className="px-3 py-2 text-end text-xs font-medium">{t('suppliers.suggestedQty')}</th>
              <th className="px-3 py-2 text-center text-xs font-medium">{t('suppliers.urgencyLevel')}</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item: any, i: number) => (
              <tr key={item.itemCode || i} className="border-t hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2 font-mono text-xs">{item.itemCode}</td>
                <td className="px-3 py-2 text-xs max-w-[200px] truncate">{item.itemName}</td>
                <td className="px-3 py-2 text-end text-xs">
                  <span className={item.currentStock === 0 ? 'text-destructive font-semibold' : ''}>
                    {item.currentStock}
                  </span>
                </td>
                <td className="px-3 py-2 text-end text-xs">{item.avgMonthlySales}</td>
                <td className="px-3 py-2 text-end text-xs font-semibold">{item.suggestedQty}</td>
                <td className="px-3 py-2 text-center">
                  {getUrgencyBadge(item.urgencyScore, t)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
