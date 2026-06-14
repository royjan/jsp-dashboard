'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'

const BAR_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899']
const PIE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444']

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
    name: isHe ? a.bracketHe : a.bracket,
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
                margin={{ top: 5, right: 30, left: 5, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
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
                  contentStyle={{
                    backgroundColor: 'var(--popover)',
                    borderColor: 'var(--border)',
                    borderRadius: '8px',
                    color: 'var(--popover-foreground)',
                  }}
                  formatter={(value: any) => [Number(value).toLocaleString(), isHe ? 'רכבים' : 'Vehicles']}
                />
                <Bar
                  dataKey="count"
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={(data: any) => onSelectMake?.(data.name)}
                >
                  {barData.map((entry, i) => (
                    <Cell
                      key={entry.name}
                      fill={BAR_COLORS[i % BAR_COLORS.length]}
                      fillOpacity={hoveredBar ? (entry.name === hoveredBar ? 1 : 0.3) : 0.85}
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
            <div className="w-full h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={110}
                    paddingAngle={3}
                    dataKey="value"
                    label={({ name, percent }: any) =>
                      percent > 0.05 ? `${name} (${(percent * 100).toFixed(0)}%)` : ''
                    }
                    labelLine={{ stroke: 'var(--muted-foreground)' }}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--popover)',
                      borderColor: 'var(--border)',
                      borderRadius: '8px',
                      color: 'var(--popover-foreground)',
                    }}
                    formatter={(value: any) => [Number(value).toLocaleString(), isHe ? 'רכבים' : 'Vehicles']}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            {/* Legend */}
            <div className="flex flex-wrap justify-center gap-4 mt-2">
              {pieData.map((item, i) => (
                <div key={item.name} className="flex items-center gap-2 text-sm">
                  <div
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                  />
                  <span className="text-muted-foreground">{item.name}</span>
                  <span className="font-mono text-xs">{item.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
