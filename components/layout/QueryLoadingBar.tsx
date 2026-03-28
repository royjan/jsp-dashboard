'use client'

import { useIsFetching } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useStreamingCount } from '@/lib/streaming-counter'

export function QueryLoadingBar() {
  const fetching = useIsFetching() + useStreamingCount()
  const [progress, setProgress] = useState(0)
  const [visible, setVisible] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number | null>(null)
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const isLoading = fetching > 0

    if (isLoading) {
      if (!startRef.current) startRef.current = Date.now()
      if (hideRef.current) { clearTimeout(hideRef.current); hideRef.current = null }
      setVisible(true)
      setProgress(p => Math.max(10, p))

      if (!animRef.current) {
        animRef.current = setInterval(() => {
          setProgress(p => {
            if (p >= 85) return p
            return Math.min(85, p + Math.max(0.3, (85 - p) * 0.04))
          })
        }, 150)
      }
      if (!elapsedRef.current) {
        elapsedRef.current = setInterval(() => {
          if (startRef.current) setElapsed(Date.now() - startRef.current)
        }, 100)
      }
    } else {
      if (animRef.current) { clearInterval(animRef.current); animRef.current = null }
      if (elapsedRef.current) { clearInterval(elapsedRef.current); elapsedRef.current = null }
      setProgress(100)
      hideRef.current = setTimeout(() => {
        setVisible(false)
        setProgress(0)
        setElapsed(0)
        startRef.current = null
      }, 900)
    }

    return () => {
      if (animRef.current) clearInterval(animRef.current)
      if (elapsedRef.current) clearInterval(elapsedRef.current)
      if (hideRef.current) clearTimeout(hideRef.current)
    }
  }, [fetching > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null

  const elapsedSec = elapsed / 1000
  const isDone = progress >= 100

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
            <span className="text-xs text-muted-foreground ml-auto tabular-nums">
              {fetching} {fetching === 1 ? 'request' : 'requests'}
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all ease-out"
            style={{
              width: `${progress}%`,
              transitionDuration: isDone ? '300ms' : '150ms',
              boxShadow: isDone ? 'none' : '0 0 8px 2px hsl(var(--primary) / 0.4)',
            }}
          />
        </div>

        {/* Time row */}
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>{elapsedSec.toFixed(1)}s elapsed</span>
          {!isDone && elapsed > 10000 && <span>still loading…</span>}
        </div>
      </div>
    </div>
  )
}
