'use client'

/**
 * One control, three current implementations.
 *
 * The dashboard's period picker (7D · 30D · 90D · YTD · 1Y · Custom), Partly's
 * view switcher (GPU · 3D · 2D) and Diego's mode toggle (הקלדה · שיחה) are the
 * same widget written three times. This is the one.
 *
 * THE INDICATOR IS MEASURED, NOT DERIVED. `transform` is physical in both
 * writing directions while `offsetLeft` is measured from the border box, so the
 * naive version — anchor nothing, translate by offsetLeft — puts the pill on the
 * wrong option under RTL, which is every screen in these apps. The indicator is
 * anchored at `left: 0` and moved by the button's rect minus the track's rect
 * minus the track's own border, which means the same thing in both directions.
 *
 * It is a real radiogroup: arrow keys move between options, because a period
 * picker that only responds to a mouse is one a keyboard user cannot reach.
 */

import * as React from 'react'
import { cn } from './cn'

export interface SegmentedOption<T extends string> {
  value: T
  label: React.ReactNode
  /** Tooltip / accessible name when the label is a glyph. */
  title?: string
}

export interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  /** Accessible name for the group, e.g. 'טווח זמן'. */
  label?: string
  className?: string
}

export function Segmented<T extends string>({
  options, value, onChange, size = 'md', label, className,
}: SegmentedProps<T>) {
  const track = React.useRef<HTMLDivElement>(null)
  const btns = React.useRef<(HTMLButtonElement | null)[]>([])
  const [box, setBox] = React.useState<{ x: number; w: number } | null>(null)

  const active = Math.max(0, options.findIndex(o => o.value === value))

  const place = React.useCallback(() => {
    const t = track.current, b = btns.current[active]
    if (!t || !b) return
    const tr = t.getBoundingClientRect(), br = b.getBoundingClientRect()
    setBox({ x: br.left - tr.left - t.clientLeft, w: br.width })
  }, [active])

  React.useLayoutEffect(() => { place() }, [place, options.length])

  React.useEffect(() => {
    // Fonts land after first paint and change every button's width, so a single
    // measurement at mount is measured against the fallback face.
    const ro = new ResizeObserver(place)
    if (track.current) ro.observe(track.current)
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    fonts?.ready.then(place).catch(() => {})
    return () => ro.disconnect()
  }, [place])

  const onKey = (e: React.KeyboardEvent) => {
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
    const fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown'
    if (!back && !fwd) return
    e.preventDefault()
    // Arrows are physical keys: in RTL, ArrowLeft moves to the NEXT option.
    const rtl = getComputedStyle(track.current!).direction === 'rtl'
    const step = (fwd ? 1 : -1) * (rtl ? -1 : 1)
    const next = (active + step + options.length) % options.length
    onChange(options[next].value)
    btns.current[next]?.focus()
  }

  return (
    <div
      ref={track}
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKey}
      className={cn(
        'relative inline-flex rounded-full border border-[var(--jan-rule)] bg-[var(--jan-raise)] p-[3px]',
        className,
      )}
    >
      {box && (
        <span
          aria-hidden="true"
          className="jan-anim absolute left-0 top-[3px] bottom-[3px] rounded-full bg-[var(--jan-callout)]"
          style={{
            width: box.w,
            transform: `translateX(${box.x}px)`,
            transitionProperty: 'transform, width',
            transitionDuration: 'var(--jan-base)',
            transitionTimingFunction: 'var(--jan-ease)',
          }}
        />
      )}
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            ref={el => { btns.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative z-[1] rounded-full font-semibold transition-colors',
              size === 'sm' ? 'px-3 py-1 text-[11.5px]' : 'px-4 py-1.5 text-[12.5px]',
              on ? 'text-[var(--jan-plate)]' : 'text-[var(--jan-dim)] hover:text-[var(--jan-ink)]',
            )}
            style={{ transitionDuration: 'var(--jan-base)' }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export default Segmented
