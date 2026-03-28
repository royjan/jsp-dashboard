'use client'

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'
import { MONTH_NAMES, ISRAELI_SEASONS } from '@/lib/constants'
import type { SeasonalDataPoint } from '@/lib/types'

interface SeasonalHeatmapProps {
  data: SeasonalDataPoint[]
  isLoading?: boolean
}

function getIntensityStyle(intensity: number, hasData: boolean): React.CSSProperties {
  if (!hasData || intensity <= 0) return { backgroundColor: 'hsl(220 13% 18%)' }
  // Interpolate hue 220→142 (blue-gray → green), saturation 15→80%, lightness 20→52%
  const t = Math.pow(intensity, 0.7) // slight gamma so low values are still visible
  const hue = Math.round(220 - t * (220 - 142))
  const sat = Math.round(15 + t * 65)
  const lit = Math.round(20 + t * 32)
  return { backgroundColor: `hsl(${hue} ${sat}% ${lit}%)` }
}

export function SeasonalHeatmap({ data, isLoading }: SeasonalHeatmapProps) {
  const { t } = useLocale()

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>{t('seasonalHeatmap')}</CardTitle></CardHeader>
        <CardContent><Skeleton className="w-full h-[400px]" /></CardContent>
      </Card>
    )
  }

  // Group data by category
  const categories = [...new Set(data.map(d => d.category))]
  const dataMap = new Map<string, Map<number, SeasonalDataPoint>>()
  for (const d of data) {
    if (!dataMap.has(d.category)) dataMap.set(d.category, new Map())
    dataMap.get(d.category)!.set(d.month, d)
  }

  // Per-row max for normalization: each row's highest month = 1.0
  const rowMax = new Map<string, number>()
  for (const category of categories) {
    const months = dataMap.get(category)!
    const max = Math.max(...Array.from(months.values()).map(p => p.avg_sales || 0))
    rowMax.set(category, max || 1)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('seasonalHeatmap')}</CardTitle>
        <CardDescription>{t('salesIntensity')}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {/* Season overlay */}
        <div className="flex mb-2 text-xs">
          <div className="w-32 shrink-0" />
          {MONTH_NAMES.map((month, i) => {
            const isSummer = ISRAELI_SEASONS.SUMMER.months.includes(i + 1)
            return (
              <div
                key={month}
                className={cn(
                  'flex-1 text-center py-1 min-w-[32px] sm:min-w-[50px]',
                  isSummer ? 'bg-amber-100/50 dark:bg-amber-900/20' : 'bg-blue-100/50 dark:bg-blue-900/20'
                )}
              >
                {month}
              </div>
            )
          })}
        </div>

        {/* Season labels */}
        <div className="flex mb-4 text-xs text-muted-foreground">
          <div className="w-32 shrink-0" />
          <div className="flex-1 flex">
            <div className="flex-1 text-center" style={{ flex: 4 }}>
              {ISRAELI_SEASONS.WINTER.icon} {t('winter')}
            </div>
            <div className="flex-1 text-center" style={{ flex: 6 }}>
              {ISRAELI_SEASONS.SUMMER.icon} {t('summer')}
            </div>
            <div className="flex-1 text-center" style={{ flex: 2 }}>
              {ISRAELI_SEASONS.WINTER.icon}
            </div>
          </div>
        </div>

        {/* Heatmap grid */}
        <div className="space-y-1">
          {categories.map((category) => (
            <div key={category} className="flex items-center gap-1">
              <div className="w-32 shrink-0 text-xs font-medium truncate" title={category}>
                {category}
              </div>
              {Array.from({ length: 12 }, (_, i) => {
                const point = dataMap.get(category)?.get(i + 1)
                const avgSales = point?.avg_sales || 0
                const hasData = !!point && avgSales > 0
                const intensity = hasData ? avgSales / rowMax.get(category)! : 0
                return (
                  <div
                    key={i}
                    className="flex-1 h-8 rounded-sm min-w-[32px] sm:min-w-[50px] transition-colors cursor-default"
                    style={getIntensityStyle(intensity, hasData)}
                    title={`${category} - ${MONTH_NAMES[i]}: ${point?.avg_sales?.toLocaleString() || 0} units`}
                  />
                )
              })}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2 mt-4 text-xs text-muted-foreground">
          <span>{t('low')}</span>
          <div className="flex gap-0.5">
            {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((v, i) => (
              <div key={i} className="w-6 h-3 rounded-sm" style={getIntensityStyle(v, v > 0)} />
            ))}
          </div>
          <span>{t('high')}</span>
        </div>
      </CardContent>
    </Card>
  )
}
