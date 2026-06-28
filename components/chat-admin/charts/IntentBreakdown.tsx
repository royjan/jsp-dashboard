'use client'

import React from 'react'

interface IntentRow {
  intent: string
  count: number
  llmShare: number
}

const META: Record<string, { label: string; color: string }> = {
  search: { label: 'חיפוש חלק', color: '#3b82f6' },
  schema_position: { label: 'מספר בשרטוט', color: '#8b5cf6' },
  confirm: { label: 'אישור', color: '#10b981' },
  reject: { label: 'דחייה', color: '#ef4444' },
  question: { label: 'שאלה', color: '#f59e0b' },
  other: { label: 'אחר', color: '#64748b' },
  unknown: { label: 'לא ידוע', color: '#64748b' },
}

function metaFor(intent: string) {
  return META[intent] || { label: intent, color: '#64748b' }
}

/** Ranked horizontal-bar distribution of classified intents, each bar overlaid
 *  with the LLM-classified share and tagged with an "AI N%" chip. */
export function IntentBreakdown({ data }: { data: IntentRow[] }) {
  const rows = (data || []).filter(r => r.count > 0).sort((a, b) => b.count - a.count)
  if (rows.length === 0) {
    return <p className="text-xs text-[var(--color-text-tertiary,#8a8a90)]">— אין נתונים —</p>
  }
  const max = Math.max(...rows.map(r => r.count))

  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => {
        const { label, color } = metaFor(r.intent)
        const widthPct = max > 0 ? (r.count / max) * 100 : 0
        return (
          <li key={i} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-baseline gap-1.5 min-w-0">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                <span className="truncate text-[var(--color-text-secondary,#c7c7cc)]">{label}</span>
                <span dir="ltr" className="font-mono text-[10px] text-[var(--color-text-tertiary,#8a8a90)]">{r.intent}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
                  style={{ background: `${color}22`, color }}>
                  AI {r.llmShare}%
                </span>
                <span className="tabular-nums text-[var(--color-text-tertiary,#8a8a90)]">{r.count.toLocaleString()}</span>
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-base,#0e0e10)]">
              <div className="h-full rounded-full" style={{ width: `${widthPct}%`, background: `${color}55` }}>
                <div className="h-full rounded-full" style={{ width: `${r.llmShare}%`, background: color }} />
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export default IntentBreakdown
