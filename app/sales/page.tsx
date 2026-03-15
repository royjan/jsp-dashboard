'use client'

import { useState } from 'react'
import { useSalesAnalytics, useTopSellingItems } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { SalesAreaChart } from '@/components/charts/SalesAreaChart'
import { ComparisonChart } from '@/components/charts/ComparisonChart'
import { PeriodSelector } from '@/components/shared/PeriodSelector'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ILS_FORMAT } from '@/lib/constants'
import type { Period, SalesDataPoint, TopSellingItem } from '@/lib/types'

export default function SalesPage() {
  const { t } = useLocale()
  const [period, setPeriod] = useState<Period>('30d')
  const { data, isLoading } = useSalesAnalytics(period)
  const { data: topData, isLoading: topLoading } = useTopSellingItems(period)

  const salesData: SalesDataPoint[] = data?.data || []
  const topItems: TopSellingItem[] = topData?.data || []
  const totalRevenue = salesData.reduce((sum, d) => sum + d.revenue, 0)
  const avgDaily = salesData.length > 0 ? totalRevenue / salesData.length : 0
  const totalTransactions = salesData.reduce((sum, d) => sum + d.count, 0)

  const midpoint = Math.floor(salesData.length / 2)
  const comparisonData = salesData.slice(midpoint).map((d, i) => ({
    date: d.date,
    current: d.revenue,
    previous: salesData[i]?.revenue || 0,
  }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PeriodSelector value={period} onChange={setPeriod} />
        <div className="flex gap-6 text-sm">
          <div>
            <span className="text-muted-foreground">{t('total')}: </span>
            <span className="font-semibold">{totalRevenue.toLocaleString('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t('avgDay')}: </span>
            <span className="font-semibold">{avgDaily.toLocaleString('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })}</span>
          </div>
          <div>
            <span className="text-muted-foreground">{t('transactions')}: </span>
            <span className="font-semibold">{totalTransactions.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <SalesAreaChart data={salesData} isLoading={isLoading} title={`${t('revenue')} (${period})`} height={350} />

      {comparisonData.length > 0 && (
        <ComparisonChart data={comparisonData} title={t('periodComparison')} />
      )}

      <Card>
        <CardHeader><CardTitle>{t('topSellingItems')}</CardTitle></CardHeader>
        <CardContent>
          {(isLoading || topLoading) ? (
            <Skeleton className="w-full h-[200px]" />
          ) : topItems.length === 0 ? (
            <div className="text-sm text-muted-foreground text-center py-8">
              {t('topItemsPlaceholder')}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-start py-2 pe-4">#</th>
                    <th className="text-start py-2 pe-4">{t('code')}</th>
                    <th className="text-start py-2 pe-4">{t('item')}</th>
                    <th className="text-end py-2 pe-4">{t('quantity')}</th>
                    <th className="text-end py-2 pe-4">{t('revenue')}</th>
                    <th className="text-end py-2 pe-4">{t('price')}</th>
                    <th className="text-end py-2">{t('stockQty')}</th>
                  </tr>
                </thead>
                <tbody>
                  {topItems.map((item, idx) => (
                    <tr key={`${item.code}-${idx}`} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="py-2 pe-4 text-muted-foreground">{idx + 1}</td>
                      <td className="py-2 pe-4 font-mono text-xs">{item.code}</td>
                      <td className="py-2 pe-4">{item.name}</td>
                      <td className="py-2 pe-4 text-end">{item.total_qty_sold.toLocaleString()}</td>
                      <td className="py-2 pe-4 text-end font-medium">{ILS_FORMAT.format(item.total_revenue)}</td>
                      <td className="py-2 pe-4 text-end">{ILS_FORMAT.format(item.avg_price)}</td>
                      <td className="py-2 text-end">
                        <span className={item.stock_qty <= 0 ? 'text-destructive font-medium' : ''}>
                          {item.stock_qty.toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
