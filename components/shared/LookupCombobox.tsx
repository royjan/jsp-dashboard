'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LookupHit } from '@/app/api/sales-rep/lookup/route'

/**
 * Type-ahead over ERP items or customers, searchable by code OR name.
 *
 * Free text still submits: a rep may hold a code the search does not surface,
 * and the price-check call is the authoritative answer either way. So this
 * never blocks input — it only offers.
 */
export function LookupCombobox({
  kind,
  value,
  onChange,
  onPick,
  onSubmit,
  placeholder,
  inputRef,
  className,
  autoFocus,
  spinnerClassName,
  inputProps,
}: {
  kind: 'item' | 'customer'
  value: string
  onChange: (v: string) => void
  onPick?: (hit: LookupHit) => void
  onSubmit?: () => void
  placeholder?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
  className?: string
  autoFocus?: boolean
  /** Where the spinner sits — move it when the caller overlays its own button. */
  spinnerClassName?: string
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>
}) {
  const [hits, setHits] = useState<LookupHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)
  const boxRef = useRef<HTMLDivElement>(null)
  // Guards a slow early request landing after a later one and overwriting it.
  const seq = useRef(0)
  // Picking sets `value`, which would otherwise retrigger the search and
  // reopen the list immediately after the user closed it by choosing.
  const justPicked = useRef(false)

  useEffect(() => {
    if (justPicked.current) {
      justPicked.current = false
      setLoading(false)
      return
    }
    const q = value.trim()
    if (q.length < 2) {
      setHits([])
      setLoading(false)
      return
    }
    const mine = ++seq.current
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sales-rep/lookup?kind=${kind}&q=${encodeURIComponent(q)}`)
        const data = await res.json()
        if (mine !== seq.current) return
        setHits(data.hits || [])
        setOpen((data.hits || []).length > 0)
        setActive(-1)
      } catch {
        if (mine === seq.current) setHits([])
      } finally {
        if (mine === seq.current) setLoading(false)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [value, kind])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const pick = (hit: LookupHit) => {
    justPicked.current = true
    onChange(hit.code)
    onPick?.(hit)
    setOpen(false)
    setHits([])
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || hits.length === 0) {
      if (e.key === 'Enter') onSubmit?.()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => (a + 1) % hits.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a <= 0 ? hits.length - 1 : a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (active >= 0 && hits[active]) pick(hits[active])
      else onSubmit?.()
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => hits.length > 0 && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        {...inputProps}
        className={cn('w-full rounded border px-3 py-2 text-sm bg-background', className)}
      />
      {loading && (
        <Loader2 className={cn('absolute top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground', spinnerClassName || 'end-2')} />
      )}
      {open && hits.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full max-h-64 overflow-auto rounded border bg-popover shadow-lg">
          {hits.map((h, i) => (
            <li key={`${h.code}-${i}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(h)}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  'w-full text-start px-3 py-2 text-sm flex items-center justify-between gap-2',
                  i === active ? 'bg-accent' : 'hover:bg-accent/60',
                )}
              >
                <span className="truncate">{h.name || h.code}</span>
                <span className="font-mono text-xs text-muted-foreground shrink-0">{h.code}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
