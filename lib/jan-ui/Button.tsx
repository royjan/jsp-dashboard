'use client'

/**
 * Button.
 *
 * `primary` is the ONLY place the callout colour appears outside a callout —
 * and that is a deliberate, single exception: the one action a screen wants you
 * to take reads as the one marked thing. If a screen needs two primaries, it
 * needs one primary.
 *
 * Copy rule, enforced by nothing but worth writing down: a button says what
 * happens. "הזמן מחדש", not "אישור" — and it keeps that name through the flow,
 * so the button that says "פרסם" produces a toast that says "פורסם".
 */

import * as React from 'react'
import { cn } from './cn'

type Variant = 'default' | 'primary' | 'ghost' | 'outline'
type Size = 'sm' | 'md'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const VARIANT: Record<Variant, string> = {
  default:
    'bg-[var(--jan-raise)] text-[var(--jan-ink)] border-[var(--jan-rule)] hover:border-[var(--jan-dim)]',
  primary:
    'bg-[var(--jan-callout)] text-[var(--jan-plate)] border-[var(--jan-callout)] font-semibold hover:brightness-110',
  ghost:
    'bg-transparent text-[var(--jan-dim)] border-transparent hover:bg-[var(--jan-raise)] hover:text-[var(--jan-ink)]',
  // Same weight as default but transparent — for a retry sitting on a card that
  // already has its own surface.
  outline:
    'bg-transparent text-[var(--jan-ink)] border-[var(--jan-rule)] hover:bg-[var(--jan-raise)]',
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'jan-anim inline-flex items-center justify-center gap-1.5 rounded-[var(--jan-radius)] border',
        'transition-[background-color,border-color,transform,filter] active:translate-y-px',
        'disabled:pointer-events-none disabled:opacity-45',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--jan-callout)]',
        size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-4 py-2 text-sm',
        VARIANT[variant],
        className,
      )}
      style={{ transitionDuration: 'var(--jan-fast)', transitionTimingFunction: 'var(--jan-ease)' }}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
export default Button
