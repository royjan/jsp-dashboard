'use client'

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { useLocale } from '@/lib/locale-context'

interface HeatmapCell {
  age: number
  intensity: number
  rawValue: number
}

interface HeatmapRow {
  category: string
  ages: HeatmapCell[]
}

interface PeakInfo {
  category: string
  peak_age: number
  peak_intensity: number
  total_sales: number
}

interface LifecycleHeatmapProps {
  heatmap: HeatmapRow[]
  peakAnalysis: PeakInfo[]
  isLoading?: boolean
}

function getIntensityStyle(intensity: number): React.CSSProperties {
  if (intensity <= 0) return { backgroundColor: 'hsl(220 13% 18%)' }
  // Per-cell solid heat scale: blue (low) through amber to red (high)
  const t = Math.pow(intensity, 0.6)
  if (t < 0.5) {
    // Blue to yellow
    const s = t * 2
    const hue = Math.round(220 - s * (220 - 45))
    const sat = Math.round(20 + s * 60)
    const lit = Math.round(20 + s * 25)
    return { backgroundColor: `hsl(${hue} ${sat}% ${lit}%)` }
  } else {
    // Yellow to red
    const s = (t - 0.5) * 2
    const hue = Math.round(45 - s * 45)
    const sat = Math.round(80 + s * 15)
    const lit = Math.round(45 - s * 10)
    return { backgroundColor: `hsl(${hue} ${sat}% ${lit}%)` }
  }
}

export function LifecycleHeatmap({ heatmap, peakAnalysis, isLoading }: LifecycleHeatmapProps) {
  const { locale } = useLocale()
  const isHe = locale === 'he'

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle><Skeleton className="h-5 w-48" /></CardTitle>
        </CardHeader>
        <CardContent><Skeleton className="w-full h-[400px]" /></CardContent>
      </Card>
    )
  }

  if (!heatmap?.length) return null

  const ages = Array.from({ length: 16 }, (_, i) => i)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isHe ? 'מפת חום מחזור חיי רכב' : 'Vehicle Lifecycle Demand Heatmap'}</CardTitle>
        <CardDescription>
          {isHe
            ? 'עוצמת ביקוש לפי גיל רכב וקטגוריית חלקים (הערכה)'
            : 'Demand intensity by vehicle age and parts category (estimate)'}
        </CardDescription>
        <Badge variant="outline" className="w-fit text-xs mt-1">
          {isHe ? 'הערכה' : 'Estimate'}
        </Badge>
      </CardHeader>
      <CardContent>
        {/* Full-bleed scroll lives on an inner div so the negative margin cancels
            CardContent's own padding instead of pushing past the card edge. */}
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
        {/* Age labels header */}
        <div className="flex mb-1 text-xs">
          <div className="w-24 sm:w-36 shrink-0" />
          {ages.map(age => (
            <div
              key={age}
              className="flex-1 text-center min-w-[32px] sm:min-w-[42px] text-muted-foreground font-mono"
            >
              {age}
            </div>
          ))}
        </div>

        {/* Year label */}
        <div className="flex mb-3 text-[10px]">
          <div className="w-24 sm:w-36 shrink-0" />
          <div className="flex-1 text-center text-muted-foreground">
            {isHe ? 'גיל הרכב (שנים)' : 'Vehicle Age (years)'}
          </div>
        </div>

        {/* Heatmap grid */}
        <div className="space-y-1">
          {heatmap.map((row) => {
            const peak = peakAnalysis.find(p => p.category === row.category)
            return (
              <div key={row.category} className="flex items-center gap-1">
                <div
                  className="w-24 sm:w-36 shrink-0 text-[10px] sm:text-xs font-medium truncate"
                  title={row.category}
                >
                  {row.category}
                </div>
                {row.ages.map((cell) => (
                  <div
                    key={cell.age}
                    className="flex-1 h-7 sm:h-8 rounded-sm min-w-[32px] sm:min-w-[42px] transition-colors cursor-default relative group"
                    style={getIntensityStyle(cell.intensity)}
                    title={`${row.category} - ${isHe ? 'גיל' : 'Age'} ${cell.age}: ${(cell.intensity * 100).toFixed(0)}%`}
                  >
                    {cell.age === peak?.peak_age && cell.intensity > 0.8 && (
                      <div className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white drop-shadow-md">
                        {isHe ? 'שיא' : 'Peak'}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-2 mt-4 text-xs text-muted-foreground">
          <span>{isHe ? 'נמוך' : 'Low'}</span>
          <div className="flex gap-0.5">
            {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((v, i) => (
              <div key={i} className="w-6 h-3 rounded-sm" style={getIntensityStyle(v)} />
            ))}
          </div>
          <span>{isHe ? 'גבוה' : 'High'}</span>
        </div>

        {/* Peak summary */}
        {peakAnalysis.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="text-sm font-medium mb-2">
              {isHe ? 'שיאי ביקוש לפי קטגוריה' : 'Demand Peaks by Category'}
            </h4>
            <div className="flex flex-wrap gap-2">
              {peakAnalysis.slice(0, 8).map(peak => (
                <Badge key={peak.category} variant="secondary" className="text-xs gap-1">
                  <span className="font-medium">{peak.category}</span>
                  <span className="text-muted-foreground">
                    {isHe ? `שיא בגיל ${peak.peak_age}` : `peaks at age ${peak.peak_age}`}
                  </span>
                </Badge>
              ))}
            </div>
          </div>
        )}
        </div>
      </CardContent>
    </Card>
  )
}
