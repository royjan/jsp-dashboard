'use client'

/**
 * Skeleton to content, without the page jumping under the reader.
 *
 * `PendingState` gave the library the third feedback state — the thing that was
 * missing when a value that is not known yet was drawn as `0`. What it did not
 * settle is the MOMENT the answer arrives, and two things go wrong there.
 *
 * THE JUMP. A skeleton whose bars are not the size of the text they stand in for
 * makes the layout resize the instant data lands, which throws away the reader's
 * place. So the skeleton here is built from the same row height and column
 * widths as the content, and the two are cross-faded in place.
 *
 * THE FLASH. A request that returns in 80ms puts a skeleton on screen for four
 * frames. That reads as a glitch, not as speed. `minVisible` means the skeleton
 * either stays long enough to be understood or is never shown at all — and the
 * fast case shows nothing, which is exactly right.
 */

import * as React from 'react'
import { cn } from './cn'

export interface SwapProps {
  /** True while the real content is still on its way. */
  pending: boolean
  /** The placeholder. Give it the content's real dimensions. */
  skeleton: React.ReactNode
  children: React.ReactNode
  /** ms the skeleton must stay once shown. Below this it never appears. */
  minVisible?: number
  /** ms of cross-fade. Short: this is a substitution, not a transition. */
  fade?: number
  className?: string
}

export function Swap({ pending, skeleton, children, minVisible = 320, fade = 180, className }: SwapProps) {
  /* `showSkeleton` is not `pending`. It turns on only after a grace period, and
     once on it stays for `minVisible` even if the answer has already arrived. */
  const [showSkeleton, setShowSkeleton] = React.useState(false)
  const shownAt = React.useRef(0)

  React.useEffect(() => {
    let grace = 0, hold = 0
    if (pending) {
      grace = window.setTimeout(() => {
        shownAt.current = performance.now()
        setShowSkeleton(true)
      }, 90)
    } else if (showSkeleton) {
      const left = minVisible - (performance.now() - shownAt.current)
      hold = window.setTimeout(() => setShowSkeleton(false), Math.max(0, left))
    }
    return () => { clearTimeout(grace); clearTimeout(hold) }
  }, [pending, minVisible, showSkeleton])

  const busy = pending || showSkeleton

  return (
    <div className={cn('relative', className)} aria-busy={busy || undefined}>
      <div
        style={{ transition: `opacity ${fade}ms var(--jan-ease)` }}
        className={cn(showSkeleton ? 'opacity-100' : 'pointer-events-none absolute inset-0 opacity-0')}
        aria-hidden={!showSkeleton}
      >
        {skeleton}
      </div>
      <div
        style={{ transition: `opacity ${fade}ms var(--jan-ease)` }}
        className={cn(showSkeleton ? 'pointer-events-none absolute inset-0 opacity-0' : 'opacity-100')}
        aria-hidden={showSkeleton}
      >
        {children}
      </div>
    </div>
  )
}

/** A bar the size of the thing it stands in for. Width in ch keeps it honest
 *  against a monospace figure; use px for anything else. */
export function SkeletonBar({ w = '8ch', h = 15, className }: { w?: string | number; h?: number; className?: string }) {
  return (
    <span
      className={cn('inline-block animate-pulse rounded-[2px] bg-[var(--jan-rule)] align-middle', className)}
      style={{ width: w, height: h }}
      aria-hidden="true"
    />
  )
}

export default Swap
