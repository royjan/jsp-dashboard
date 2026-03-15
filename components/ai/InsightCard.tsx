'use client'

import { motion } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useLocale } from '@/lib/locale-context'
import { TrendingUp, AlertTriangle, Snowflake, PackageSearch } from 'lucide-react'
import type { AIInsight, InsightType, InsightSeverity } from '@/lib/types'

const INSIGHT_ICONS: Record<InsightType, typeof TrendingUp> = {
  demand_spike: TrendingUp,
  dead_stock_warning: AlertTriangle,
  seasonal_prediction: Snowflake,
  reorder_urgency: PackageSearch,
}

const SEVERITY_VARIANTS: Record<InsightSeverity, 'default' | 'warning' | 'destructive'> = {
  info: 'default',
  warning: 'warning',
  critical: 'destructive',
}

interface InsightCardProps {
  insight: AIInsight
  index?: number
}

export function InsightCard({ insight, index = 0 }: InsightCardProps) {
  const { dir } = useLocale()
  const Icon = INSIGHT_ICONS[insight.type] || TrendingUp

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, delay: index * 0.1 }}
    >
      <Card className="hover:shadow-md transition-shadow" dir={dir}>
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 mt-0.5 shrink-0">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="font-medium text-sm">{insight.title}</h4>
                <Badge variant={SEVERITY_VARIANTS[insight.severity]} className="text-[10px] px-1.5">
                  {insight.severity}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">{insight.description}</p>
              {insight.related_items.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {insight.related_items.slice(0, 5).map((code) => (
                    <Badge key={code} variant="outline" className="text-[10px] font-mono" dir="ltr">{code}</Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
