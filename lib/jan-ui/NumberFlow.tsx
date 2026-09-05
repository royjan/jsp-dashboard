'use client'

/**
 * A figure that counts to its value, and three ways of not having one.
 *
 * The counting is the small part. The reason this is a component is the other
 * three states, each of which has shipped wrong somewhere:
 *
 *   UNKNOWN  — Diego printed `₪0.00` for a catalogue row that simply has no
 *              price. A missing number formatted like a real one is a lie the
 *              reader has no way to detect. It renders an em dash.
 *   MASKED   — the dashboard's privacy toggle blanks money to `₪•••`. That is
 *              correct, but it must not go through the counter: a masked figure
 *              animating is nonsense, and it must never briefly show the real
 *              number on the way there.
 *   ZERO     — a genuine zero is a value and IS drawn, which is exactly why the
 *              other two must not look like it.
 *
 * Digits are tabular so the number does not shiver while it climbs, and the
 * whole animation is skipped under `prefers-reduced-motion` — where it lands on
 * the final value immediately rather than not rendering.
 */

import * as React from 'react'
import { cn } from './cn'

export interface NumberFlowProps {
  /** null / undefined / NaN all mean UNKNOWN — never zero. */
  value: number | null | undefined
  /** Blank the figure without revealing it. Wins over everything below. */
  masked?: boolean
  /** Prefix glyph, e.g. '₪'. Kept outside the counter so it never animates. */
  currency?: string
  /** Decimal places. Money wants 2; counts want 0. */
  decimals?: number
  /** Animation length in ms. 0 renders the final value with no motion. */
  duration?: number
  /** What to render when the value is unknown. Default '—'. */
  placeholder?: React.ReactNode
  className?: string
}

const usePrefersReducedMotion = () => {
  const [reduced, setReduced] = React.useState(false)
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

export function NumberFlow({
  value, masked = false, currency, decimals = 0, duration = 900,
  placeholder = '—', className,
}: NumberFlowProps) {
  const known = typeof value === 'number' && Number.isFinite(value)
  const target = known ? (value as number) : 0
  const reduced = usePrefersReducedMotion()
  const [shown, setShown] = React.useState(target)
  const frame = React.useRef<number | null>(null)

  React.useEffect(() => {
    // Masked and unknown never run the counter. Masked especially: stepping
    // toward the real figure would show it, which is the one thing the mask is
    // for. `shown` is still kept in step so unmasking does not re-animate from
    // a stale number.
    if (!known || masked || reduced || duration <= 0) { setShown(target); return }
    const from = shown
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setShown(from + (target - from) * eased)
      if (p < 1) frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
    return () => { if (frame.current) cancelAnimationFrame(frame.current) }
    // `shown` is deliberately not a dependency: it changes on every frame, and
    // reading it here is how the next animation starts from where the last one
    // stopped rather than snapping back to zero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, known, masked, reduced, duration])

  const body = masked
    ? '•••'
    : known
      ? shown.toLocaleString('en-US', {
          minimumFractionDigits: decimals, maximumFractionDigits: decimals,
        })
      : placeholder

  return (
    <span
      className={cn(
        'tabular-nums',
        masked && 'tracking-widest text-[var(--jan-faint)]',
        !known && !masked && 'text-[var(--jan-faint)]',
        className,
      )}
      dir="ltr"
      // The real figure is what a reader with a screen reader should get, and
      // the intermediate frames are not it.
      aria-label={masked ? 'מוסתר' : known ? undefined : 'אין ערך'}
    >
      {/* An unknown value has no currency: '₪ —' reads as a price of nothing,
          which is the same confusion as ₪0.00 in a different costume. */}
      {currency && known && !masked ? (
        <span className="me-0.5 text-[0.62em] text-[var(--jan-faint)]">{currency}</span>
      ) : null}
      {currency && masked ? (
        <span className="me-0.5 text-[0.62em] text-[var(--jan-faint)]">{currency}</span>
      ) : null}
      {body}
    </span>
  )
}

export default NumberFlow
