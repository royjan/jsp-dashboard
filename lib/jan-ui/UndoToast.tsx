'use client'

/**
 * Change the row now, send the request in five seconds, offer the way back.
 *
 * The dashboard has a route that takes 216 seconds on a bad day. A destructive
 * action that waits for the server on a screen like that looks like it did
 * nothing, so the operator clicks it again — and now there are two.
 *
 * So the row changes immediately and the REQUEST is what waits. For those five
 * seconds "undo" costs nothing at all, because nothing has been sent yet. That
 * is the whole reason this is worth the complexity: it is not an optimistic
 * write that has to be rolled back, it is a write that has not happened.
 *
 * WHAT THIS DEMANDS OF THE CALLER, and why it is not on by default everywhere:
 * `commit` must be safe to never call, and the local state must be restorable.
 * Wire it to a small number of deliberate actions, not to every button.
 */

import * as React from 'react'
import { cn } from './cn'

export interface PendingAction {
  id: string
  /** Shown in the toast, e.g. '״מסנן שמן״ נמחק'. */
  label: React.ReactNode
  /** Sent when the timer runs out. Must be safe to never call. */
  commit: () => void | Promise<void>
  /** Puts the local state back. Called on undo, and on a failed commit. */
  revert: () => void
}

export interface UseUndoableOptions {
  /** Seconds before the request is actually sent. */
  seconds?: number
  /** Called when a commit throws, after `revert` has run. */
  onError?: (err: unknown, action: PendingAction) => void
}

export function useUndoable({ seconds = 5, onError }: UseUndoableOptions = {}) {
  const [action, setAction] = React.useState<PendingAction | null>(null)
  const [left, setLeft] = React.useState(seconds)
  const timer = React.useRef<number | null>(null)

  const clear = React.useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null }
  }, [])

  const run = React.useCallback((a: PendingAction) => {
    /* A second action while one is still pending commits the first rather than
       dropping it: silently discarding a delete the operator already saw
       confirmed is the worst outcome available here. */
    setAction((prev) => {
      if (prev) void Promise.resolve(prev.commit()).catch((e) => { prev.revert(); onError?.(e, prev) })
      return a
    })
    setLeft(seconds)
  }, [seconds, onError])

  const undo = React.useCallback(() => {
    clear()
    setAction((a) => { a?.revert(); return null })
  }, [clear])

  React.useEffect(() => {
    if (!action) return
    timer.current = window.setInterval(() => {
      setLeft((n) => {
        if (n > 1) return n - 1
        clear()
        void Promise.resolve(action.commit()).catch((e) => { action.revert(); onError?.(e, action) })
        setAction(null)
        return 0
      })
    }, 1000)
    return clear
  }, [action, clear, onError])

  React.useEffect(() => clear, [clear])

  return { action, left, run, undo }
}

export interface UndoToastProps {
  action: PendingAction | null
  left: number
  onUndo: () => void
  className?: string
}

export function UndoToast({ action, left, onUndo, className }: UndoToastProps) {
  return (
    <div
      className={cn(
        'pointer-events-none fixed bottom-4 end-4 z-40 transition-all duration-300 ease-[var(--jan-ease)]',
        action ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0',
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {action && (
        <div className="pointer-events-auto flex items-center gap-4 rounded-[var(--jan-radius)] border border-[var(--jan-rule)] bg-[var(--jan-steel)] px-4 py-2.5 shadow-lg">
          <span className="text-[13px] text-[var(--jan-ink)]">{action.label}</span>
          <span className="font-mono text-[12px] tabular-nums text-[var(--jan-faint)]" dir="ltr">{left}</span>
          <button
            type="button"
            onClick={onUndo}
            className="rounded-full border border-[var(--jan-callout)] px-3 py-1 text-[12.5px] font-semibold text-[var(--jan-callout)] hover:bg-[var(--jan-callout-soft)]"
          >
            ביטול
          </button>
        </div>
      )}
    </div>
  )
}

export default UndoToast
