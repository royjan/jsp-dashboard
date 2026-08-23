'use client'

import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip } from 'recharts'
import { AXIS_PROPS } from '@/components/charts/kit'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useLocale } from '@/lib/locale-context'
import { URGENCY_BANDS } from '@/lib/constants'
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
    // Normalize against the top band, not a bare ×10 — the score's range grew
    // when real quote demand entered the numerator (p95 ≈ 26, max ≈ 230), so ×10
    // would peg almost every reorder candidate at 100.
    { metric: t('urgency'), value: Math.min((item.urgency_score / URGENCY_BANDS.severe) * 100, 100) },
    { metric: t('supplierFreshness'), value: (item.supplier_freshness ?? 0.5) * 100 },
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
            <PolarGrid />
            <PolarAngleAxis dataKey="metric" {...AXIS_PROPS} />
            <Radar
              dataKey="value"
              stroke="var(--primary)"
              fill="var(--primary)"
              fillOpacity={0.25}
              strokeWidth={2}
            />
            <Tooltip
            />
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
