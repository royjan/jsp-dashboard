'use client'

import React from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface LambdaRow {
  lambda: string
  count: number
  notFound: number
  notFoundRate: number
  p95: number
}

const TOOLTIP_STYLE = { background: '#1b1b1f', border: '1px solid #333', borderRadius: 8, fontSize: 12 }

function rateColor(rate: number): string {
  if (rate >= 30) return '#ef4444'
  if (rate >= 15) return '#f59e0b'
  return '#10b981'
}

/** Horizontal volume bars per portal, plus a not-found-rate chip list. */
export function PortalBars({ data }: { data: LambdaRow[] }) {
  if (!data || data.length === 0) {
    return <p className="text-xs text-[var(--color-text-tertiary,#8a8a90)]">— no portal activity in range —</p>
  }
  const sorted = [...data].sort((a, b) => b.count - a.count)
  const height = Math.max(120, sorted.length * 38)

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={sorted} layout="vertical" margin={{ left: 8, right: 16 }}>
          <XAxis type="number" tick={{ fontSize: 11, fill: '#8a8a90' }} allowDecimals={false} />
          <YAxis type="category" dataKey="lambda" width={70} tick={{ fontSize: 11, fill: '#c7c7cc' }} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(val: any) => [val.toLocaleString(), 'searches']}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {sorted.map((r, i) => <Cell key={i} fill={rateColor(r.notFoundRate)} fillOpacity={0.85} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <ul className="space-y-1">
        {sorted.map((r, i) => (
          <li key={i} className="flex items-center justify-between gap-2 text-xs">
            <span dir="ltr" className="font-mono text-[var(--color-text-secondary,#c7c7cc)]">{r.lambda}</span>
            <span className="flex items-center gap-2">
              <span className="rounded-md px-1.5 py-0.5 font-medium" style={{ background: `${rateColor(r.notFoundRate)}22`, color: rateColor(r.notFoundRate) }}>
                {r.notFoundRate}% not found
              </span>
              <span className="tabular-nums text-[var(--color-text-tertiary,#8a8a90)]">p95 {r.p95}ms</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default PortalBars
