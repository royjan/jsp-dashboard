'use client'

/**
 * Filter-bar primitives, lifted out of the /competitors page so other
 * URL-driven tables get the same behaviour instead of a near-copy.
 *
 * (app/competitors/page.tsx still carries its own local copies of these two —
 * swapping it over is a mechanical follow-up, deliberately left out of the
 * catalog-gap change so that diff stays isolated.)
 */

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * A text box backed by a query-string param.
 *
 * Typing stays local and updates the URL on a debounce, so a keystroke is not a
 * history entry and filtering still feels instant. The reverse direction matters
 * just as much: when the URL changes underneath us — Back/Forward, "clear
 * filters", a pasted link — the box adopts that value instead of racing to
 * overwrite it, which is what a one-way effect does.
 */
export function useUrlTextInput(urlValue: string, commit: (v: string | null) => void) {
  const [value, setValue] = useState(urlValue)
  const pushed = useRef(urlValue)
  useEffect(() => {
    if (urlValue !== pushed.current) {
      pushed.current = urlValue
      setValue(urlValue)
      return
    }
    if (value === urlValue) return
    const id = setTimeout(() => {
      pushed.current = value
      commit(value || null)
    }, 350)
    return () => clearTimeout(id)
  }, [value, urlValue, commit])
  return [value, setValue] as const
}

/**
 * A labelled segmented control — one row of mutually exclusive choices where
 * `null` is the unfiltered default. Real <button>s, so it tabs and fires on
 * Enter/Space for free; styling is logical-property only so it mirrors in RTL.
 */
export function Segmented<V extends string>({
  label, value, options, onChange,
}: {
  label: string
  value: V | null
  options: Array<{ value: V | null; label: string; title?: string }>
  onChange: (v: V | null) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="inline-flex rounded-md border p-0.5">
        {options.map(o => {
          const on = value === o.value
          return (
            <button
              key={o.value ?? '_all'}
              type="button"
              title={o.title}
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={cn(
                'rounded px-2 py-1 text-xs transition-colors',
                'inline-flex items-center justify-center pointer-coarse:min-h-11 pointer-coarse:px-3',
                on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
