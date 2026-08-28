'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { ChartGrid, BAR_RADIUS, BAR_MAX, PIE_PROPS, DonutCenter, ACTIVE_BAR, ActivePieSector } from '@/components/charts/kit'
import { seriesColor } from '@/lib/chart-colors'

// 15 distinct, bright colors so the top-15 manufacturers never reuse a hue.
/**
 * The bar chart is a single series over nominal categories that the axis
 * already names, so hue there encoded nothing -- 15 colors spent restating the
 * label. One slot for every bar; the hover fade carries the emphasis.
 * The pie is different: there hue IS the identity channel, so it takes distinct
 * slots via seriesColor(), which folds past slot 8 into muted rather than
 * cycling two entities onto one color.
 */
const BAR_COLOR = 'var(--chart-1)'

interface ManufacturerData {
  manufacturer: string
  count: number
  models: { model: string; count: number }[]
}

interface AgeData {
  bracket: string
  bracketHe: string
  count: number
}

interface PopulationChartProps {
  manufacturers: ManufacturerData[]
  ageDistribution: AgeData[]
  totalVehicles: number
  isLoading?: boolean
  onSelectMake?: (make: string) => void
}

export function PopulationChart({
  manufacturers,
  ageDistribution,
  totalVehicles,
  isLoading,
  onSelectMake,
}: PopulationChartProps) {
  const { locale } = useLocale()
  const isHe = locale === 'he'
  const [hoveredBar, setHoveredBar] = useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle><Skeleton className="h-5 w-40" /></CardTitle></CardHeader>
          <CardContent><Skeleton className="w-full h-[350px]" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle><Skeleton className="h-5 w-40" /></CardTitle></CardHeader>
          <CardContent><Skeleton className="w-full h-[350px]" /></CardContent>
        </Card>
      </div>
    )
  }

  const barData = manufacturers.slice(0, 15).map(m => ({
    name: m.manufacturer,
    count: m.count,
  }))

  const pieData = ageDistribution.map(a => ({
    name: (isHe ? a.bracketHe : a.bracket) || a.bracket || a.bracketHe || '—',
    value: a.count,
  }))

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Manufacturers bar chart */}
      <Card>
        <CardHeader>
          <CardTitle>{isHe ? 'יצרנים מובילים' : 'Top Manufacturers'}</CardTitle>
          <CardDescription>
            {isHe
              ? `סה"כ ${totalVehicles.toLocaleString()} רכבים רשומים`
              : `${totalVehicles.toLocaleString()} total registered vehicles`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[380px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={barData}
                layout="vertical"
                barCategoryGap="22%"
                margin={{ top: 5, right: 40, left: 5, bottom: 5 }}
              >
                <ChartGrid vertical horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
                />
                <YAxis
                  dataKey="name"
                  type="category"
                  width={100}
                  tick={{ fill: 'var(--foreground)', fontSize: 11 }}
                />
                <Tooltip
                  cursor={{ fill: 'var(--muted)', fillOpacity: 0.15 }}
                  formatter={(value: any) => [Number(value).toLocaleString(), isHe ? 'רכבים' : 'Vehicles']}
                />
                <Bar activeBar={ACTIVE_BAR}
                  dataKey="count"
                  radius={BAR_RADIUS.horizontal}
                  maxBarSize={BAR_MAX}
                  cursor="pointer"
                  onClick={(data: any) => onSelectMake?.(data.name)}
                >
                  {barData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={BAR_COLOR}
                      // Keep bars at full color; only gently fade the rest on
                      // hover (was 0.3 → near-black/muddy on the dark theme).
                      fillOpacity={hoveredBar && entry.name !== hoveredBar ? 0.55 : 1}
                      onMouseEnter={() => setHoveredBar(entry.name)}
                      onMouseLeave={() => setHoveredBar(null)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Age distribution donut */}
      <Card>
        <CardHeader>
          <CardTitle>{isHe ? 'התפלגות גיל רכבים' : 'Vehicle Age Distribution'}</CardTitle>
          <CardDescription>
            {isHe ? 'לפי שנת רישום' : 'By registration year'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[380px] flex flex-col items-center">
            <div className="relative w-full h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie activeShape={ActivePieSector}
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={110}
                    dataKey="value"
                    {...PIE_PROPS}
                    label={({ percent }: any) =>
                      percent > 0.04 ? `${(percent * 100).toFixed(0)}%` : ''
                    }
                    labelLine={false}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={seriesColor(i)} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: any) => [Number(value).toLocaleString(), isHe ? 'רכבים' : 'Vehicles']}
                  />
                </PieChart>
              </ResponsiveContainer>
              <DonutCenter
                value={totalVehicles.toLocaleString()}
                label={isHe ? 'רכבים' : 'vehicles'}
              />
            </div>
            {/* Legend */}
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 mt-3">
              {pieData.map((item, i) => {
                const total = pieData.reduce((s, p) => s + p.value, 0)
                const pct = total ? Math.round((item.value / total) * 100) : 0
                return (
                  <div key={item.name} className="flex items-center gap-2">
                    <span
                      className="w-3.5 h-3.5 rounded-full shrink-0"
                      style={{ backgroundColor: seriesColor(i) }}
                    />
                    <span className="text-sm font-medium">{item.name}</span>
                    <span className="text-sm font-mono tabular-nums">{item.value.toLocaleString()}</span>
                    <span className="text-xs text-muted-foreground">({pct}%)</span>
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
