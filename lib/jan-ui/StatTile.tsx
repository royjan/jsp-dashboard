'use client'

/**
 * One headline number, with room to say where it came from.
 *
 * `provenance` is optional and unstyled here on purpose — pass a <Chip>. A tile
 * that can only show a figure is how a five-month-old snapshot passes for live,
 * so the slot exists even when a caller leaves it empty.
 */

import * as React from 'react'
import { cn } from './cn'

export interface StatTileProps {
  label: React.ReactNode
  value: React.ReactNode
  /** One line under the value: the denominator, the window, the row count. */
  detail?: React.ReactNode
  /** Usually a <Chip> saying live / cached / sampled / unavailable. */
  provenance?: React.ReactNode
  tone?: 'default' | 'good' | 'bad'
  /** Index in a group, for the staggered entrance. */
  index?: number
  className?: string
}

const TONE = {
  default: 'text-[var(--jan-ink)]',
  good: 'text-[var(--jan-verdigris)]',
  bad: 'text-[var(--jan-oxide)]',
} as const

export function StatTile({
  label, value, detail, provenance, tone = 'default', index = 0, className,
}: StatTileProps) {
  return (
    <div
      className={cn(
        'jan-anim rounded-[var(--jan-radius)] border border-[var(--jan-rule)] bg-[var(--jan-steel)] p-3.5',
        'motion-safe:animate-[jan-rise_var(--jan-base)_var(--jan-ease)_both]',
        className,
      )}
      style={{ animationDelay: `calc(${index} * var(--jan-stagger))` }}
    >
      <div className="flex items-start gap-2">
        <span className="flex-1 text-xs text-[var(--jan-dim)]">{label}</span>
        {provenance}
      </div>
      <div className={cn('mt-0.5 text-2xl font-semibold tabular-nums tracking-tight', TONE[tone])}>
        {value}
      </div>
      {detail && <div className="mt-0.5 text-[11px] text-[var(--jan-faint)]">{detail}</div>}
    </div>
  )
}
export default StatTile
