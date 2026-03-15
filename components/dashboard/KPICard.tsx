'use client'

import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { AnimatedCounter } from '@/components/shared/AnimatedCounter'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'
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
}

export function KPICard({ label, value, format, icon: Icon, trend, changePercent, iconColor = 'text-blue-500', iconBg = 'bg-blue-500/10' }: KPICardProps) {
  const { t } = useLocale()
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="relative overflow-hidden">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">{label}</p>
              <AnimatedCounter value={value} format={format} className="text-2xl font-bold" />
            </div>
            <div className={cn('rounded-full p-2.5', iconBg)}>
              <Icon className={cn('h-5 w-5', iconColor)} />
            </div>
          </div>
          {changePercent !== undefined && (
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
