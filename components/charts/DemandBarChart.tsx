'use client'

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import type { DemandItem } from '@/lib/types'

const COLORS = ['#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#fb7185', '#fb923c', '#38bdf8', '#4ade80', '#e879f9', '#f87171']

interface DemandBarChartProps {
  data: DemandItem[]
  isLoading?: boolean
  mode: 'count' | 'qty'
  limit?: number
  hoveredCode?: string | null
  onHover?: (code: string | null) => void
}

export function DemandBarChart({ data, isLoading, mode, limit = 10, hoveredCode, onHover }: DemandBarChartProps) {
  const { t } = useLocale()

  if (isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle>{t('topDemandedParts')}</CardTitle></CardHeader>
        <CardContent><Skeleton className="w-full h-[400px]" /></CardContent>
      </Card>
    )
  }

  const filtered = data
    .filter(item => item.code.length > 1 && item.name.length > 1)
    .slice(0, limit)

  const chartData = filtered.map(item => ({
    name: item.name.length > 22 ? item.name.slice(0, 22) + '...' : item.name,
    code: item.code,
    value: mode === 'count' ? item.request_count : item.total_qty_requested,
    fullName: item.name,
  }))

  const total = chartData.reduce((s, d) => s + d.value, 0)

  const renderLabel = ({ name, percent, cx, x, y }: any) => {
    if (percent < 0.05) return null
    const isRight = x > cx
    return (
      <text x={x} y={y} fill="var(--foreground)" fontSize={11} fontWeight={500} textAnchor={isRight ? 'start' : 'end'}>
        {name}
      </text>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('topDemandedParts')} ({mode === 'count' ? t('byRequests') : t('byQuantity')})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col lg:flex-row items-center gap-4">
          <div className="w-full lg:w-1/2" style={{ height: 350 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={120}
                  paddingAngle={2}
                  dataKey="value"
                  label={renderLabel}
                  labelLine={{ stroke: 'var(--muted-foreground)' }}
                >
                  {chartData.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={COLORS[index % COLORS.length]}
                      fillOpacity={hoveredCode ? (entry.code === hoveredCode ? 1 : 0.2) : 1}
                      stroke={entry.code === hoveredCode ? '#fff' : 'none'}
                      strokeWidth={entry.code === hoveredCode ? 2 : 0}
                      onMouseEnter={() => onHover?.(entry.code)}
                      onMouseLeave={() => onHover?.(null)}
                      style={{ cursor: 'pointer' }}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--popover)', borderColor: 'var(--border)', borderRadius: '8px', color: 'var(--popover-foreground)' }}
                  formatter={(value: number) => {
                    const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0'
                    return [`${value} (${pct}%)`, mode === 'count' ? t('requests') : t('quantity')]
                  }}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName || ''}
                  labelStyle={{ color: 'var(--popover-foreground)', fontWeight: 'bold' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          {/* Legend as a list */}
          <div className="w-full lg:w-1/2 space-y-1.5">
            {chartData.map((item, i) => {
              const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0'
              const isHighlighted = item.code === hoveredCode
              const isDimmed = hoveredCode && !isHighlighted
              return (
                <div
                  key={`${item.code}-${i}`}
                  className="flex items-center gap-2 text-sm rounded px-1.5 py-0.5 transition-colors cursor-pointer"
                  style={{
                    opacity: isDimmed ? 0.3 : 1,
                    backgroundColor: isHighlighted ? 'var(--accent)' : 'transparent',
                  }}
                  onMouseEnter={() => onHover?.(item.code)}
                  onMouseLeave={() => onHover?.(null)}
                >
                  <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="flex-1 truncate text-foreground">{item.fullName}</span>
                  <span className="text-muted-foreground font-mono text-xs">{item.value} ({pct}%)</span>
                </div>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
