'use client'

import type React from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'

interface ComparisonChartProps {
  data: Array<{ date: string; current: number; previous: number; previousDate?: string }>
  title?: string
  isLoading?: boolean
  headerActions?: React.ReactNode
}

export function ComparisonChart({ data, title, isLoading, headerActions }: ComparisonChartProps) {
  const { t } = useLocale()
  const displayTitle = title || t('periodComparison')

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap pb-3">
        <CardTitle>{displayTitle}</CardTitle>
        {headerActions}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="w-full h-[220px] sm:h-[280px] lg:h-[350px]" />
        ) : data.length === 0 ? (
          <div className="flex items-center justify-center h-[220px] sm:h-[280px] lg:h-[350px] text-muted-foreground text-sm">
            {t('noInsights')}
          </div>
        ) : (
        <div className="h-[220px] sm:h-[280px] lg:h-[350px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="currentGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="previousGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--muted-foreground)" stopOpacity={0.2} />
                <stop offset="95%" stopColor="var(--muted-foreground)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#4a5168" />
            <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#e2e8f0' }} tickLine={{ stroke: '#4a5168' }} axisLine={{ stroke: '#4a5168' }} />
            <YAxis tick={{ fontSize: 12, fill: '#e2e8f0' }} tickLine={{ stroke: '#4a5168' }} axisLine={{ stroke: '#4a5168' }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
            <Tooltip
              contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--popover-foreground)' }}
              formatter={(value: any, name: any, props: any) => {
                const formatted = `₪${Number(value).toLocaleString()}`
                if (name === t('previous') && props?.payload?.previousDate) {
                  return [formatted, `${name} (${props.payload.previousDate})`]
                }
                return [formatted, name]
              }}
              labelStyle={{ color: 'var(--muted-foreground)' }}
            />
            <Legend />
            <Area type="monotone" dataKey="previous" name={t('previous')} stroke="var(--muted-foreground)" fill="url(#previousGrad)" strokeDasharray="5 5" />
            <Area type="monotone" dataKey="current" name={t('current')} stroke="var(--primary)" fill="url(#currentGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
        </div>
        )}
      </CardContent>
    </Card>
  )
}
