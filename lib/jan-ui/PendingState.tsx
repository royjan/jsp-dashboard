'use client'

/**
 * The third state.
 *
 * The library already ships <ErrorState> and <EmptyState>. It never shipped a
 * loading one, and the gap has a cost you can watch: /stock renders four
 * headline tiles reading `0` for nineteen seconds while its query is still in
 * flight. A warehouse manager who reads "מלאי מת 0" concludes there is no dead
 * stock. Zero is a value. It is not a state.
 *
 * So the rule this component exists to enforce is: A VALUE THAT IS NOT KNOWN IS
 * NOT DRAWN AS A NUMBER. <Pending> renders the shape of the answer instead —
 * same box, same height, nothing that can be misread as a figure.
 *
 * The second job is the wait itself. `waitingFor` names what is being read, and
 * after `escalateAfter` seconds the component says so out loud, because a
 * spinner that has been turning for twenty seconds with no explanation is
 * indistinguishable from one that is stuck. The receivables route costs ~216s
 * cold; a screen that never admits that is a screen people reload.
 */

import * as React from 'react'
import { cn } from './cn'

export interface PendingProps {
  /** Skeleton bar count. One per line of the answer this is standing in for. */
  lines?: number
  /** Width of each bar, as a CSS length or percentage. Cycles if shorter. */
  widths?: string[]
  /** Bar height. Match the type it replaces — a headline needs a tall bar. */
  height?: string
  /** What is being read, in Hebrew: 'יתרות לקוחות', 'מלאי'. Shown on escalation. */
  waitingFor?: string
  /** Seconds before the wait explains itself. 0 disables. Default 8. */
  escalateAfter?: number
  /** Overrides the default escalation sentence. */
  escalationNote?: React.ReactNode
  className?: string
}

/**
 * Seconds elapsed since mount, ticking only until it passes `after`.
 *
 * Exported because the panels that do not use <Pending> — a chart area, a map —
 * still need to know when to start explaining themselves.
 */
export function useWaitedTooLong(after = 8): boolean {
  const [late, setLate] = React.useState(false)
  React.useEffect(() => {
    if (!after) return
    const id = setTimeout(() => setLate(true), after * 1000)
    return () => clearTimeout(id)
  }, [after])
  return late
}

const DEFAULT_WIDTHS = ['72%', '54%', '63%']

export function Pending({
  lines = 3,
  widths = DEFAULT_WIDTHS,
  height = 'h-3.5',
  waitingFor,
  escalateAfter = 8,
  escalationNote,
  className,
}: PendingProps) {
  const late = useWaitedTooLong(escalateAfter)
  return (
    <div
      className={cn('jan-anim flex flex-col gap-2', className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {/* The only text a screen reader needs; the bars themselves are decoration. */}
      <span className="sr-only">{waitingFor ? `טוען ${waitingFor}` : 'טוען'}</span>
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={cn(
            'block rounded-[var(--jan-radius)] bg-[var(--jan-raise)]',
            'motion-safe:animate-pulse',
            height,
          )}
          style={{ width: widths[i % widths.length] }}
        />
      ))}
      {late && (
        <span className="text-[12px] text-[var(--jan-callout)]">
          {escalationNote ?? (
            <>עדיין קורא{waitingFor ? ` ${waitingFor}` : ''} — אפשר להמשיך לעבוד במסך אחר.</>
          )}
        </span>
      )}
    </div>
  )
}

/**
 * A single bar, for standing in a place that already has its own layout — a
 * table cell, the value slot of a tile. `lines` would fight the grid there.
 */
export function PendingBar({
  width = '70%', height = 'h-4', className,
}: { width?: string; height?: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'jan-anim inline-block rounded-[var(--jan-radius)] bg-[var(--jan-raise)]',
        'motion-safe:animate-pulse align-middle',
        height,
        className,
      )}
      style={{ width }}
    />
  )
}

export default Pending
