'use client'

/**
 * The callout marker — a numbered badge tying a row to a place on a diagram.
 *
 * This is the one component borrowed straight from the subject rather than from
 * a UI kit. Every person using these apps reads ServiceBox plates: a technical
 * drawing with numbered callouts and a parts table keyed to them. `partly`
 * stores that number as `scheme_number` on 1,258,661 of 1,260,472 rows.
 *
 * ABSENCE IS NOT A VALUE. The scrapers write the literal string '-' when a part
 * has no callout, and treating that as a number is exactly how a customer was
 * told to look for callout "-" on a drawing. It renders an em dash and reports
 * itself as absent, never as a marker.
 */

import { cn } from './cn'

export interface CalloutMarkerProps {
  /** The callout as stored. '-' , '' and null all mean ABSENT, not zero. */
  value?: string | number | null
  /** Lit when its row (or its part on the drawing) is the current one. */
  lit?: boolean
  size?: 'sm' | 'md'
  className?: string
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

/** The scrapers' absent-marker, plus the obvious empties. */
export function isCalloutAbsent(v: string | number | null | undefined): boolean {
  if (v === null || v === undefined) return true
  const s = String(v).trim()
  return s === '' || s === '-' || s === '—'
}

export function CalloutMarker({
  value,
  lit = false,
  size = 'md',
  className,
  onMouseEnter,
  onMouseLeave,
}: CalloutMarkerProps) {
  const absent = isCalloutAbsent(value)
  return (
    <span
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      aria-label={absent ? 'ללא סימון בשרטוט' : `סימון ${value}`}
      className={cn(
        'jan-anim inline-grid place-items-center shrink-0 rounded-full border font-mono tabular-nums',
        'transition-[color,background-color,border-color,transform,box-shadow]',
        size === 'sm' ? 'h-[22px] w-[22px] text-[11px]' : 'h-[26px] w-[26px] text-[12px]',
        absent
          ? 'border-dashed text-[var(--jan-faint)] border-[var(--jan-rule)] bg-transparent'
          : lit
            ? 'scale-110 text-[var(--jan-plate)] bg-[var(--jan-callout)] border-[var(--jan-callout)] shadow-[0_0_0_5px_var(--jan-callout-soft)]'
            : 'text-[var(--jan-dim)] bg-[var(--jan-raise)] border-[var(--jan-rule)]',
        className,
      )}
      style={{ transitionDuration: 'var(--jan-fast)', transitionTimingFunction: 'var(--jan-ease)' }}
    >
      {absent ? '—' : value}
    </span>
  )
}

export default CalloutMarker
