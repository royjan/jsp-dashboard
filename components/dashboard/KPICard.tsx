'use client'

import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { AnimatedCounter } from '@/components/shared/AnimatedCounter'
import { Sparkline } from '@/components/charts/Sparkline'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { isDeclineHidden } from '@/lib/privacy'
import type { LucideIcon } from 'lucide-react'

interface KPICardProps {
  label: string
  value: number
  previousValue?: number
  format: 'currency' | 'number' | 'percent'
  icon: LucideIcon
  trend?: 'up' | 'down' | 'flat'
  changePercent?: number
  iconColor?: string
  iconBg?: string
  /** Recent values behind this KPI, oldest → newest. Omit when none exists. */
  sparkline?: number[]
  sparkColor?: string
  sparkTitle?: string
}

export function KPICard({ label, value, format, icon: Icon, trend, changePercent, iconColor = 'text-primary', iconBg = 'bg-primary/10', sparkline, sparkColor, sparkTitle }: KPICardProps) {
  const { t } = useLocale()
  useMoneyHidden()
  // Demo mode drops the whole row rather than the number alone — a red
  // TrendingDown beside a blank still reads as "we are down".
  const hideTrend = isDeclineHidden(trend === 'down' || (changePercent ?? 0) < 0)
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="relative overflow-hidden">
        <CardContent className="p-3 sm:p-4 lg:p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1 min-w-0">
              <p className="text-xs sm:text-sm text-muted-foreground truncate">{label}</p>
              <AnimatedCounter value={value} format={format} className="text-lg sm:text-xl lg:text-2xl font-bold" />
            </div>
            <div className={cn('rounded-full p-2.5', iconBg)}>
              <Icon className={cn('h-5 w-5', iconColor)} />
            </div>
          </div>
          {sparkline && sparkline.length > 1 && (
            <div className="mt-2 -mb-0.5">
              <Sparkline
                data={sparkline}
                color={sparkColor || 'var(--primary)'}
                title={sparkTitle}
                width={160}
                height={26}
                className="w-full"
              />
            </div>
          )}
          {changePercent !== undefined && !hideTrend && (
            <div className="mt-2 flex items-center gap-1 text-xs">
              {trend === 'up' && <TrendingUp className="h-3 w-3 text-emerald-500" />}
              {trend === 'down' && <TrendingDown className="h-3 w-3 text-red-500" />}
              {trend === 'flat' && <Minus className="h-3 w-3 text-muted-foreground" />}
              <span className={cn(
                trend === 'up' && 'text-emerald-500',
                trend === 'down' && 'text-red-500',
                trend === 'flat' && 'text-muted-foreground',
              )}>
                {changePercent > 0 ? '+' : ''}{changePercent.toFixed(1)}%
              </span>
              <span className="text-muted-foreground">{t('vsLastPeriod')}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  )
}
