'use client'

/**
 * How old the number is.
 *
 * `/api/analytics/receivables` costs ~216 seconds cold — it reads a live balance
 * for every customer — so it is served stale-while-revalidate behind a lock and
 * warmed by cron. That is the right architecture and it is invisible: a figure
 * computed four hours ago is drawn identically to one computed a second ago.
 *
 * The component does not ask for a "last updated" line in the corner. It asks
 * for the age to be part of the figure's own presentation, because the decision
 * a reader makes with a four-hour-old receivables total is a different decision.
 *
 * `revalidating` is the honest middle: the number on screen is the old one AND a
 * new one is on its way. Both facts at once, which a spinner alone cannot say.
 */

import * as React from 'react'
import { cn } from './cn'

export interface FreshnessProps {
  /** When the figure was computed. Date, ISO string or epoch ms. */
  at: Date | string | number | null | undefined
  /** A refresh is in flight; what is on screen is still the old value. */
  revalidating?: boolean
  /** Older than this many minutes reads as stale rather than current. Default 30. */
  staleAfterMinutes?: number
  /** Optional manual refresh. Omit for a figure the user cannot re-trigger. */
  onRefresh?: () => void
  className?: string
}

/** Hebrew relative age, coarse on purpose: "לפני 4 שעות" is the decision, not 4:12. */
export function ageLabel(ms: number): string {
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'עכשיו'
  if (min < 60) return `לפני ${min} דק׳`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `לפני ${hr} שע׳`
  const days = Math.floor(hr / 24)
  return days === 1 ? 'אתמול' : `לפני ${days} ימים`
}

export function Freshness({
  at, revalidating = false, staleAfterMinutes = 30, onRefresh, className,
}: FreshnessProps) {
  const ts = at == null ? null : new Date(at).getTime()
  const valid = ts !== null && Number.isFinite(ts)

  // Re-render on a slow tick so "לפני 3 דק׳" does not sit there saying "עכשיו"
  // for the life of the page. A minute is fine; this is not a clock.
  const [, bump] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    const id = setInterval(bump, 60000)
    return () => clearInterval(id)
  }, [])

  const age = valid ? Date.now() - (ts as number) : 0
  const stale = valid && age > staleAfterMinutes * 60000
  const state = revalidating ? 'loading' : !valid ? 'unknown' : stale ? 'stale' : 'fresh'

  const TONE = {
    fresh: 'text-[var(--jan-verdigris)] border-[color-mix(in_srgb,var(--jan-verdigris)_35%,transparent)]',
    stale: 'text-[var(--jan-callout)] border-[color-mix(in_srgb,var(--jan-callout)_35%,transparent)]',
    loading: 'text-[var(--jan-callout)] border-[color-mix(in_srgb,var(--jan-callout)_35%,transparent)]',
    unknown: 'text-[var(--jan-faint)] border-[var(--jan-rule)]',
  } as const

  const DOT = {
    fresh: 'bg-[var(--jan-verdigris)]',
    stale: 'bg-[var(--jan-callout)] motion-safe:animate-pulse',
    loading: 'bg-[var(--jan-callout)] motion-safe:animate-pulse',
    unknown: 'bg-transparent border border-dashed border-current',
  } as const

  const text =
    state === 'loading' ? 'מרענן…'
    : state === 'unknown' ? 'זמן עדכון לא ידוע'
    : ageLabel(age)

  const Tag = onRefresh ? 'button' : 'span'

  return (
    <Tag
      {...(onRefresh ? { type: 'button' as const, onClick: onRefresh } : {})}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border bg-[var(--jan-steel)] px-3 py-1 text-[12.5px]',
        TONE[state],
        onRefresh && 'cursor-pointer hover:border-[var(--jan-callout)]',
        className,
      )}
      title={valid ? new Date(ts as number).toLocaleString('he-IL') : undefined}
    >
      <span aria-hidden="true" className={cn('h-2 w-2 shrink-0 rounded-full', DOT[state])} />
      <span>{text}</span>
      {/* Said only when it is true, so it stays a signal rather than a label. */}
      {revalidating && (
        <span className="text-[var(--jan-faint)]">· הנתון על המסך עדיין הישן</span>
      )}
    </Tag>
  )
}

export default Freshness
