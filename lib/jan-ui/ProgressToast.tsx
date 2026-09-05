'use client'

/**
 * The wait, said in the app's own language and out of the content's way.
 *
 * What the dashboard shows today is a panel floating in the middle-bottom of the
 * screen, on top of the chart it is loading, reading:
 *
 *     Loading data…   requests 3   ·   3.8s elapsed   ·   still loading
 *
 * Three things wrong, all fixed here. It is in ENGLISH inside a fully Hebrew
 * RTL app. It sits ON the content instead of beside it. And it counts requests,
 * which is a fact about our fan-out and not about the reader's question —
 * `waitingFor` names the thing being fetched instead: 'יתרות לקוחות'.
 *
 * `note` is the escalation. The receivables path costs ~216 seconds cold, and a
 * bar that has been creeping for twenty seconds with no explanation is
 * indistinguishable from one that has hung. Saying why is what keeps someone
 * from reloading and starting the 216 seconds again.
 */

import * as React from 'react'
import { cn } from './cn'

export interface ProgressToastProps {
  /** Hidden entirely when false, so a caller can leave it mounted. */
  open: boolean
  /** What is being read, in Hebrew. Not a request count. */
  waitingFor: string
  /** 0–1. Omit for an indeterminate wait — the bar then does not lie about progress. */
  progress?: number
  /** Sub-line, e.g. '3 מתוך 4 מקורות'. */
  detail?: React.ReactNode
  /** Shown once the wait is long enough to need explaining. */
  note?: React.ReactNode
  /** Seconds before `note` appears. Default 8. */
  noteAfter?: number
  done?: boolean
  className?: string
}

export function ProgressToast({
  open, waitingFor, progress, detail, note, noteAfter = 8, done = false, className,
}: ProgressToastProps) {
  const [secs, setSecs] = React.useState(0)

  React.useEffect(() => {
    if (!open || done) return
    setSecs(0)
    const t0 = Date.now()
    const id = setInterval(() => setSecs((Date.now() - t0) / 1000), 200)
    return () => clearInterval(id)
  }, [open, done, waitingFor])

  if (!open) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        // Anchored to the inline-end bottom corner, which is the LEFT in these
        // RTL apps — away from the content and away from the sidebar rail.
        'fixed bottom-4 end-4 z-20 w-[min(22rem,calc(100vw-2rem))]',
        'rounded-[var(--jan-radius)] border border-[var(--jan-rule)] bg-[var(--jan-steel)]',
        'p-3.5 shadow-[0_14px_34px_-18px_rgba(0,0,0,.85)]',
        'jan-anim motion-safe:animate-[jan-rise_var(--jan-base)_var(--jan-ease)_both]',
        className,
      )}
    >
      <div className="flex items-center gap-2.5 text-[13.5px] font-bold">
        <span
          aria-hidden="true"
          className={cn(
            'h-3.5 w-3.5 shrink-0 rounded-full border-2',
            done
              ? 'border-[var(--jan-verdigris)]'
              : 'border-[var(--jan-rule)] border-t-[var(--jan-callout)] motion-safe:animate-spin',
          )}
        />
        <span>{done ? `${waitingFor} — מוכן` : waitingFor}</span>
      </div>

      <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-[var(--jan-raise)]">
        <span
          className={cn(
            'block h-full rounded-full',
            done ? 'bg-[var(--jan-verdigris)]' : 'bg-[var(--jan-callout)]',
            // An unknown duration gets a travelling bar, not a fake percentage.
            progress === undefined && !done && 'w-1/3 motion-safe:animate-pulse',
          )}
          style={
            progress !== undefined || done
              ? {
                  width: `${Math.round((done ? 1 : progress ?? 0) * 100)}%`,
                  transition: 'width var(--jan-base) var(--jan-ease)',
                }
              : undefined
          }
        />
      </div>

      <div className="mt-1.5 flex justify-between text-[12px] text-[var(--jan-faint)]">
        <span>{detail}</span>
        <span className="font-mono tabular-nums" dir="ltr">{secs.toFixed(1)}s</span>
      </div>

      {note && secs >= noteAfter && !done && (
        <p className="mt-1.5 mb-0 text-[12px] text-[var(--jan-callout)]">{note}</p>
      )}
    </div>
  )
}

export default ProgressToast
