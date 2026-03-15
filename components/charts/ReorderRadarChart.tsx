'use client'

import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useLocale } from '@/lib/locale-context'
import type { ReorderItem } from '@/lib/types'

interface ReorderRadarChartProps {
  item: ReorderItem
}

export function ReorderRadarChart({ item }: ReorderRadarChartProps) {
  const { t } = useLocale()

  const radarData = [
    { metric: t('demandVelocity'), value: Math.min(item.demand_velocity * 50, 100) },
    { metric: t('stockCoverage'), value: Math.min(100 - (item.stock_coverage / 12) * 100, 100) },
    { metric: t('seasonalFit'), value: item.seasonal_relevance * 100 },
    { metric: t('customerBreadth'), value: item.customer_breadth * 100 },
    { metric: t('urgency'), value: Math.min(item.urgency_score * 10, 100) },
  ]

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{item.name}</CardTitle>
        <p className="text-xs text-muted-foreground">{item.code} | {t('score')}: {item.urgency_score}</p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <RadarChart data={radarData}>
            <PolarGrid stroke="#4a5168" />
            <PolarAngleAxis dataKey="metric" tick={{ fontSize: 10, fill: '#e2e8f0' }} />
            <Radar
              dataKey="value"
              stroke="var(--primary)"
              fill="var(--primary)"
              fillOpacity={0.25}
              strokeWidth={2}
            />
            <Tooltip
              contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--popover-foreground)' }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
