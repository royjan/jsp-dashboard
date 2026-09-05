'use client'

/**
 * One headline number, with room to say where it came from.
 *
 * `provenance` is optional and unstyled here on purpose — pass a <Chip>. A tile
 * that can only show a figure is how a five-month-old snapshot passes for live,
 * so the slot exists even when a caller leaves it empty.
 *
 * `pending` is the state the tile did not have. /stock renders four of these
 * reading `0` for nineteen seconds while the query is in flight, and a zero on a
 * dead-stock tile is an answer, not a wait. When `pending` is set the figure is
 * not drawn at all — see PendingState.tsx for why that is the rule.
 *
 * `spark` exists so a ROW of tiles composes. The overview screen has four and
 * only two carry a trend line, which is why they read as four unrelated boxes
 * rather than one header. The line shows direction; the figure remains the only
 * thing anyone reads a number off.
 */

import * as React from 'react'
import { cn } from './cn'
import { PendingBar } from './PendingState'
import { Sparkline } from './charts'

export interface StatTileProps {
  label: React.ReactNode
  value: React.ReactNode
  /** One line under the value: the denominator, the window, the row count. */
  detail?: React.ReactNode
  /** Usually a <Chip> saying live / cached / sampled / unavailable. */
  provenance?: React.ReactNode
  tone?: 'default' | 'good' | 'bad'
  /** The value is not known YET. Suppresses `value` — never renders as zero. */
  pending?: boolean
  /** What is being read, for the pending state's own label. */
  waitingFor?: string
  /** Trend series. Direction sets the hue; it carries no readable scale. */
  spark?: number[]
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
  label, value, detail, provenance, tone = 'default',
  pending = false, waitingFor, spark, index = 0, className,
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
        {pending ? <PendingBar width="68%" height="h-7" /> : value}
      </div>
      {pending ? (
        <div className="mt-0.5 text-[11px] text-[var(--jan-faint)]">
          {waitingFor ? `קורא ${waitingFor}…` : 'טוען…'}
        </div>
      ) : (
        detail && <div className="mt-0.5 text-[11px] text-[var(--jan-faint)]">{detail}</div>
      )}
      {/* Drawn only with a real series AND a real value: a trend line beside a
          skeleton implies the figure it is a trend of has already arrived. */}
      {!pending && spark && spark.length > 1 && (
        <Sparkline values={spark} height={26} draw className="mt-2" />
      )}
    </div>
  )
}
export default StatTile
