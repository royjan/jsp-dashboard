'use client'

import { useMemo } from 'react'
import { KPICard } from './KPICard'
import { KPIGridSkeleton } from './KPICardSkeleton'
import { useLocale } from '@/lib/locale-context'
import { DollarSign, FileText, Truck, ShoppingCart } from 'lucide-react'

interface KPIGridProps {
  data: any
  isLoading: boolean
  /**
   * Daily sales points from the page's selected period, used only to draw the
   * sparkline under the two month-to-date sales cards.
   */
  dailySales?: Array<{ date: string; revenue: number; count: number }>
}

/**
 * Month-to-date slice of the page's series — but only when the series actually
 * reaches back to the 1st. The selected period is the user's (7d shows four
 * days of August), and a sparkline drawn under "monthly sales" from a partial
 * month would read as the month's shape while showing a tail of it.
 */
function monthToDate(daily: KPIGridProps['dailySales']): Array<{ revenue: number; count: number }> | null {
  if (!daily?.length) return null
  const firstOfMonth = new Date()
  firstOfMonth.setDate(1)
  const monthStart = firstOfMonth.toISOString().split('T')[0]

  const earliest = daily.reduce((min, d) => (d.date < min ? d.date : min), daily[0].date)
  if (earliest > monthStart) return null

  const rows = daily.filter(d => d.date >= monthStart).sort((a, b) => a.date.localeCompare(b.date))
  return rows.length > 1 ? rows : null
}

export function KPIGrid({ data, isLoading, dailySales }: KPIGridProps) {
  const { t } = useLocale()
  const mtd = useMemo(() => monthToDate(dailySales), [dailySales])

  if (isLoading) {
    return <KPIGridSkeleton />
  }

  const monthlySalesTotal = data?.this_month_sales?.total || 0
  const monthlySalesCount = data?.this_month_sales?.count || 0
  const sparkTitle = t('dailyThisMonth')

  const kpis = [
    {
      label: t('monthlySales'),
      value: monthlySalesTotal,
      format: 'currency' as const,
      icon: DollarSign,
      iconColor: 'text-emerald-500',
      iconBg: 'bg-emerald-500/10',
      sparkline: mtd?.map(d => d.revenue),
      sparkColor: '#10b981',
      sparkTitle,
    },
    {
      label: t('openQuotes'),
      value: data?.open_quotes?.count || 0,
      format: 'number' as const,
      icon: FileText,
      iconColor: 'text-blue-500',
      iconBg: 'bg-blue-500/10',
    },
    {
      label: t('pendingDeliveries'),
      value: data?.open_delivery_notes?.count || 0,
      format: 'number' as const,
      icon: Truck,
      iconColor: 'text-amber-500',
      iconBg: 'bg-amber-500/10',
    },
    {
      label: t('monthlySales') + ' #',
      value: monthlySalesCount,
      format: 'number' as const,
      icon: ShoppingCart,
      iconColor: 'text-violet-500',
      iconBg: 'bg-violet-500/10',
      sparkline: mtd?.map(d => d.count),
      sparkColor: '#8b5cf6',
      sparkTitle,
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
      {kpis.map((kpi) => (
        <KPICard key={kpi.label} {...kpi} />
      ))}
    </div>
  )
}
