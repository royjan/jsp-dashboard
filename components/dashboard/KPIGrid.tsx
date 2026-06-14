'use client'

import { KPICard } from './KPICard'
import { KPIGridSkeleton } from './KPICardSkeleton'
import { useLocale } from '@/lib/locale-context'
import { DollarSign, FileText, Truck, ShoppingCart } from 'lucide-react'

interface KPIGridProps {
  data: any
  isLoading: boolean
}

export function KPIGrid({ data, isLoading }: KPIGridProps) {
  const { t } = useLocale()

  if (isLoading) {
    return <KPIGridSkeleton />
  }

  const monthlySalesTotal = data?.this_month_sales?.total || 0
  const monthlySalesCount = data?.this_month_sales?.count || 0

  const kpis = [
    {
      label: t('monthlySales'),
      value: monthlySalesTotal,
      format: 'currency' as const,
      icon: DollarSign,
      iconColor: 'text-emerald-500',
      iconBg: 'bg-emerald-500/10',
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
