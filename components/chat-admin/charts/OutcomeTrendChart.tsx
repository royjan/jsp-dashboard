'use client'

import React from 'react'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'

interface DailyRow {
  date: string
  total: number
  notFound: number
  oos: number
}

interface OutcomeTrendChartProps {
  daily: DailyRow[]
  /** Per-day deterministic-nav coverage % keyed by date (optional). */
  coverage?: Record<string, number>
  height?: number
}

const TOOLTIP_STYLE = { background: '#1b1b1f', border: '1px solid #333', borderRadius: 8, fontSize: 12 }

/**
 * 100%-stacked outcome areas (in-stock / OOS / not-found) with an indigo
 * deterministic-coverage line on a secondary axis. Percentages are derived
 * client-side from absolute daily counts.
 */
export function OutcomeTrendChart({ daily, coverage, height = 260 }: OutcomeTrendChartProps) {
  const data = daily.map(d => {
    const total = d.total || 0
    const inStock = Math.max(0, total - d.notFound - d.oos)
    const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 1000) / 10 : 0)
    return {
      date: d.date,
      inStockPct: pctOf(inStock),
      oosPct: pctOf(d.oos),
      notFoundPct: pctOf(d.notFound),
      coverage: coverage ? coverage[d.date] ?? 0 : undefined,
      total,
    }
  })

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2e" />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8a8a90' }} />
        <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#8a8a90' }} domain={[0, 100]} unit="%" />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#818cf8' }} domain={[0, 100]} unit="%" />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val: any, name: any) => [`${val}%`, name]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Area yAxisId="left" type="monotone" dataKey="inStockPct" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.45} name="in stock" />
        <Area yAxisId="left" type="monotone" dataKey="oosPct" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.45} name="OOS" />
        <Area yAxisId="left" type="monotone" dataKey="notFoundPct" stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.45} name="not found" />
        {coverage && (
          <Line yAxisId="right" type="monotone" dataKey="coverage" stroke="#6366f1" strokeWidth={2} dot={false} name="deterministic %" />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export default OutcomeTrendChart
