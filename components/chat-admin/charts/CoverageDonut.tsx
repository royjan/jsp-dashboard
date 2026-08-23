'use client'

import React from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'

interface FlowSourceRow {
  source: string
  count: number
}

const COLORS: Record<string, string> = {
  pg: '#10b981',
  none: '#f59e0b',
  unknown: '#64748b',
}
const LABELS: Record<string, string> = {
  pg: 'deterministic (pg)',
  none: 'raw LLM (none)',
  unknown: 'unknown',
}


/** Donut of the flow-decision-source split with a center deterministic-coverage % label. */
export function CoverageDonut({ data, pct }: { data: FlowSourceRow[]; pct: number }) {
  const rows = (data || []).filter(r => r.count > 0)
  if (rows.length === 0) {
    return <p className="text-xs text-[var(--color-text-tertiary,#8a8a90)]">— no navigation telemetry in range —</p>
  }

  return (
    <div className="grid grid-cols-2 items-center gap-3">
      <div className="relative" style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height={160}>
          <PieChart>
            <Pie data={rows as unknown as Record<string, unknown>[]} dataKey="count" nameKey="source" cx="50%" cy="50%" innerRadius={48} outerRadius={70} paddingAngle={2} stroke="none">
              {rows.map((r, i) => <Cell key={i} fill={COLORS[r.source] || '#64748b'} />)}
            </Pie>
            <Tooltip formatter={(val: any, name: any) => [val.toLocaleString(), LABELS[name] || name]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold text-emerald-400">{pct}%</span>
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-tertiary,#8a8a90)]">deterministic</span>
        </div>
      </div>
      <ul className="space-y-1.5 text-xs">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[r.source] || '#64748b' }} />
              <span className="text-[var(--color-text-secondary,#c7c7cc)]">{LABELS[r.source] || r.source}</span>
            </span>
            <span className="tabular-nums text-[var(--color-text-tertiary,#8a8a90)]">{r.count.toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default CoverageDonut
