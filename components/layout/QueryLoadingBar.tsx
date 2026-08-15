'use client'

import { useIsFetching } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useStreamingCount } from '@/lib/streaming-counter'

/** How long the finished "Done" card lingers before it disappears. */
const HIDE_DELAY_MS = 900

/** The creep curve: starts at 10%, decays toward 85%, never reaches it. */
const PROGRESS_FLOOR = 10
const PROGRESS_CEILING = 85
/** Time constant, tuned to match the old 150ms `p += (85 - p) * 0.04` stepper. */
const PROGRESS_TAU_MS = 3675

/**
 * A bottom-centre progress card for in-flight queries.
 *
 * The previous version scheduled its own hide inside the same effect that drove
 * the progress animation, and that effect's cleanup cancelled the hide. Because
 * the effect only re-ran when `fetching > 0` CHANGED, any cleanup not followed
 * by a real transition cancelled the hide without scheduling a new one — the
 * card was then stuck on "Done" at 100% until a reload.
 *
 * The fix is an invariant rather than choreography: whenever the card is
 * visible and nothing is fetching, a hide timer exists. That effect re-runs on
 * both `isLoading` and `visible`, so a cancelled timer is always recreated.
 * Progress is derived from elapsed time instead of being ticked into state,
 * which removes the second timer that had to stay in sync with the first.
 */
export function QueryLoadingBar() {
  const fetching = useIsFetching() + useStreamingCount()
  const isLoading = fetching > 0

  const [visible, setVisible] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number | null>(null)

  // ── Show, and tick the elapsed clock, while loading ──
  useEffect(() => {
    if (!isLoading) return

    if (!startRef.current) startRef.current = Date.now()
    setVisible(true)

    const ticker = setInterval(() => {
      if (startRef.current) setElapsed(Date.now() - startRef.current)
    }, 100)

    return () => clearInterval(ticker)
  }, [isLoading])

  // ── Hide once nothing is fetching ──
  // Depends on `visible` too, so the timer is re-established on every run of
  // this effect. That is what makes stranding impossible.
  useEffect(() => {
    if (isLoading || !visible) return

    const hide = setTimeout(() => {
      setVisible(false)
      setElapsed(0)
      startRef.current = null
    }, HIDE_DELAY_MS)

    return () => clearTimeout(hide)
  }, [isLoading, visible])

  if (!visible) return null

  const isDone = !isLoading
  const progress = isDone
    ? 100
    : PROGRESS_CEILING - (PROGRESS_CEILING - PROGRESS_FLOOR) * Math.exp(-elapsed / PROGRESS_TAU_MS)

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none">
      <div className="bg-background/95 backdrop-blur-sm border rounded-xl shadow-2xl px-5 py-4 flex flex-col gap-3 w-72 pointer-events-auto">
        {/* Header row */}
        <div className="flex items-center gap-2.5">
          {isDone ? (
            <div className="w-4 h-4 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 5.5L4 7.5L8 3" />
              </svg>
            </div>
          ) : (
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin flex-shrink-0" />
          )}
          <span className="text-sm font-medium">
            {isDone ? 'Done' : 'Loading data…'}
          </span>
          {!isDone && (
            <span className="text-xs text-muted-foreground ms-auto tabular-nums">
              {fetching} {fetching === 1 ? 'request' : 'requests'}
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 start-0 bg-primary rounded-full transition-all ease-out"
            style={{
              width: `${progress}%`,
              transitionDuration: isDone ? '300ms' : '150ms',
              // `--primary` is a hex colour, not HSL channels, so the old
              // `hsl(var(--primary) / 0.4)` was invalid and rendered no glow.
              boxShadow: isDone ? 'none' : '0 0 8px 2px color-mix(in srgb, var(--primary) 40%, transparent)',
            }}
          />
        </div>

        {/* Time row */}
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>{(elapsed / 1000).toFixed(1)}s elapsed</span>
          {!isDone && elapsed > 10000 && <span>still loading…</span>}
        </div>
      </div>
    </div>
  )
}
