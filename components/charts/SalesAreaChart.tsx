'use client'

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import type { SalesDataPoint } from '@/lib/types'

const CHART_COLOR = 'var(--primary)'

interface SalesAreaChartProps {
  data: SalesDataPoint[]
  isLoading?: boolean
  title?: string
  height?: number
}

export function SalesAreaChart({ data, isLoading, title, height = 300 }: SalesAreaChartProps) {
  const { t, locale } = useLocale()
  const displayTitle = title || t('salesTrend')
  const dateLocale = locale === 'he' ? 'he-IL' : 'en-IL'

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>{displayTitle}</CardTitle></CardHeader>
        <CardContent><Skeleton className="w-full" style={{ height }} /></CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader><CardTitle>{displayTitle}</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLOR} stopOpacity={0.3} />
                <stop offset="95%" stopColor={CHART_COLOR} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#4a5168" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12, fill: '#e2e8f0' }}
              tickLine={{ stroke: '#4a5168' }}
              axisLine={{ stroke: '#4a5168' }}
              tickFormatter={(v) => new Date(v).toLocaleDateString(dateLocale, { month: 'short', day: 'numeric' })}
            />
            <YAxis
              tick={{ fontSize: 12, fill: '#e2e8f0' }}
              tickLine={{ stroke: '#4a5168' }}
              axisLine={{ stroke: '#4a5168' }}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`}
            />
            <Tooltip
              contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--popover-foreground)' }}
              formatter={(value: number) => [`₪${value.toLocaleString()}`, t('revenue')]}
              labelFormatter={(label) => new Date(label).toLocaleDateString(dateLocale, { weekday: 'short', month: 'short', day: 'numeric' })}
              labelStyle={{ color: 'var(--muted-foreground)' }}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke={CHART_COLOR}
              strokeWidth={2}
              fill="url(#salesGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
