'use client'

/**
 * Hold one row while reading it.
 *
 * `DataTable` marks the selected row with a background, which is enough to say
 * WHICH row is selected and not enough to keep an eye on it. On a fifty-row
 * receivables screen the reader's job is to carry one line across to a column
 * three screens wide, and a slightly different grey does not survive that trip.
 *
 * Focus mode drops everything else to 35% and leaves the row at full strength
 * with a callout rule down its edge. `Escape` leaves. It is the same gesture as
 * tapping a part on the public site — deliberately, so somebody who has seen one
 * already knows the other.
 *
 * DIMMING, NOT HIDING. The neighbours stay legible enough to give the row its
 * context; a filter would remove the very thing the reader is comparing against.
 */

import * as React from 'react'
import { cn } from './cn'

export function useFocusRow<T extends string | number>() {
  const [focused, setFocused] = React.useState<T | null>(null)

  React.useEffect(() => {
    if (focused === null) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocused(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused])

  const toggle = React.useCallback((id: T) => {
    setFocused((cur) => (cur === id ? null : id))
  }, [])

  /** Class for one row, given the id it carries. */
  const rowClass = React.useCallback(
    (id: T) =>
      cn(
        'transition-opacity duration-[var(--jan-base)] ease-[var(--jan-ease)]',
        focused !== null && focused !== id && 'opacity-[.35]',
        focused === id && 'shadow-[inset_3px_0_0_var(--jan-callout)]',
      ),
    [focused],
  )

  return { focused, setFocused, toggle, rowClass, active: focused !== null }
}

/** The one control the mode needs: a way out that is visible without a keyboard. */
export function FocusExit({ active, onExit, className }: { active: boolean; onExit: () => void; className?: string }) {
  if (!active) return null
  return (
    <button
      type="button"
      onClick={onExit}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-[var(--jan-rule)] px-3 py-1',
        'text-[12px] text-[var(--jan-dim)] hover:text-[var(--jan-ink)]',
        className,
      )}
    >
      יציאה ממצב מיקוד
      <kbd className="font-mono text-[10.5px] text-[var(--jan-faint)]" dir="ltr">Esc</kbd>
    </button>
  )
}

export default useFocusRow
