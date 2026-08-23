'use client'

import React from 'react'
import Link from 'next/link'
import { GraduationCap, ArrowRight } from 'lucide-react'
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'

interface LearningLoopStripProps {
  total: number
  addedInRange: number
  daily: Array<{ date: string; added: number }>
}


/** Mini learning-loop KPI + cumulative sparkline of newly-learned pins. */
export function LearningLoopStrip({ total, addedInRange, daily }: LearningLoopStripProps) {
  let running = 0
  const cumulative = daily.map(d => {
    running += d.added
    return { date: d.date, cumulative: running, added: d.added }
  })

  return (
    <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center">
      <div className="shrink-0">
        <div className="flex items-center gap-2 text-sm text-[var(--color-text-tertiary,#8a8a90)]">
          <GraduationCap className="h-4 w-4 text-violet-400" /> Learned pins
        </div>
        <div className="mt-1 text-2xl font-semibold text-violet-400">
          {total.toLocaleString()}
          <span className="ml-2 text-sm font-medium text-emerald-400">+{addedInRange.toLocaleString()} this period</span>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {cumulative.length > 0 ? (
          <ResponsiveContainer width="100%" height={48}>
            <LineChart data={cumulative}>
              <Tooltip formatter={(v: any) => [v, 'total']} labelFormatter={(l) => l} />
              <Line type="monotone" dataKey="cumulative" stroke="#8b5cf6" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-xs text-[var(--color-text-tertiary,#8a8a90)]">No new pins learned in this period.</p>
        )}
      </div>

      <Link
        href="/chat/flow-decisions?source=learned"
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-violet-500/40 px-3 py-1.5 text-sm text-violet-300 hover:bg-violet-500/10"
      >
        Manage pins <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  )
}

export default LearningLoopStrip
