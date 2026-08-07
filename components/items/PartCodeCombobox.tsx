'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { brandChipClasses } from '@/lib/brand'
import type { CatalogHit } from '@/app/api/catalog/search/route'

/**
 * Type-ahead over the partly catalog for picking a part to link to.
 *
 * Search accepts a code prefix OR a description in either language, because you rarely
 * remember the equivalent's number — you know it's "the front brake disc". Each row shows the
 * brand, the code, the description and whether we actually sell it, so the choice is made on
 * visible facts rather than a remembered string.
 *
 * Free text still submits (Enter with nothing highlighted): some codes are legitimately absent
 * from the catalog, and the server gives the authoritative answer either way.
 */
export function PartCodeCombobox({
  value,
  onChange,
  onPick,
  onSubmit,
  isHe,
  exclude,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  onPick: (hit: CatalogHit) => void
  onSubmit: () => void
  isHe: boolean
  exclude?: string
  disabled?: boolean
}) {
  const [hits, setHits] = useState<CatalogHit[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(-1)
  const boxRef = useRef<HTMLDivElement>(null)
  // guards against a slow early request landing after a later one and overwriting it
  const seq = useRef(0)
  // picking sets `value`, which would otherwise retrigger the search and REOPEN the list
  // right after the user closed it by choosing
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
    const t = setTimeout(async () => {
      try {
        const url = `/api/catalog/search?q=${encodeURIComponent(q)}${
          exclude ? `&exclude=${encodeURIComponent(exclude)}` : ''
        }`
        const res = await fetch(url)
        const body = await res.json().catch(() => ({ hits: [] }))
        if (mine !== seq.current) return
        setHits(body.hits ?? [])
        setActive(-1)
        setOpen(true)
      } finally {
        if (mine === seq.current) setLoading(false)
      }
    }, 200)                                   // debounce: one request per pause, not per keypress
    return () => clearTimeout(t)
  }, [value, exclude])

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  const choose = (hit: CatalogHit) => {
    justPicked.current = true
    onPick(hit)
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!hits.length) return
      e.preventDefault()
      setOpen(true)
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1
        return (next + hits.length) % hits.length
      })
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (open && active >= 0 && hits[active]) choose(hits[active])
      else onSubmit()
      return
    }
    if (e.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        {/* start-2 / end-2 are the LOGICAL insets — they flip with the Hebrew RTL layout */}
        <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={isHe ? 'קוד או תיאור (0816K8 / רצועת תזמון)' : 'Code or description (0816K8 / timing belt)'}
          dir="auto"
          className="h-8 w-72 rounded-md border bg-background ps-7 pe-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        {loading && (
          <Loader2 className="absolute end-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-[26rem] max-w-[80vw] overflow-hidden rounded-md border bg-popover shadow-lg">
          {hits.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              {isHe
                ? 'לא נמצא בקטלוג — אפשר בכל זאת ללחוץ "קשר" ולבדוק'
                : 'Not found in the catalog — you can still press Link to try'}
            </p>
          ) : (
            <>
              {/* What the reader is looking at. Without this the rows are just codes: it isn't
                  obvious they come from the MANUFACTURER's catalog (not our stock list), nor
                  that the badge says whether we can actually supply the part. */}
              <p className="border-b px-3 py-1.5 text-[10px] leading-snug text-muted-foreground">
                {isHe
                  ? 'תוצאות מקטלוג היצרן (PSA / MG / טויוטה). "במלאי שלנו" = קיים ב-ERP וניתן למכירה; "קטלוג בלבד" = חלק מקורי שאיננו מחזיקים.'
                  : 'Results from the manufacturer catalog (PSA / MG / Toyota). "in ERP" = we can sell it; "catalog only" = a genuine part we do not stock.'}
              </p>
              <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
              {hits.map((hit, i) => (
                <li key={hit.code} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(hit)}
                    className={`flex w-full flex-col gap-0.5 px-3 py-1.5 text-start transition-colors ${
                      i === active ? 'bg-accent' : ''
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${brandChipClasses(hit.brand)}`}
                      >
                        {hit.brand}
                      </span>
                      <span className="font-mono text-xs" dir="ltr">{hit.code}</span>
                      <span
                        className={`ms-auto text-[10px] ${hit.inErp ? 'text-emerald-500' : 'text-muted-foreground'}`}
                        title={
                          hit.inErp
                            ? (isHe ? 'קיים אצלנו ב-ERP' : 'Exists in our ERP')
                            : (isHe ? 'בקטלוג היצרן בלבד — לא נמכר אצלנו' : 'Manufacturer catalog only — not sold by us')
                        }
                      >
                        {hit.inErp ? (isHe ? 'במלאי שלנו' : 'in ERP') : (isHe ? 'קטלוג בלבד' : 'catalog only')}
                      </span>
                    </span>
                    {/* Both languages, Hebrew first: a lot of hebrew_description values are junk
                        ("אאאא", a pasted code), and showing only those would hide the one
                        readable label — the manufacturer's English description. */}
                    {(hit.hebrewDescription || hit.description) && (
                      <span className="truncate text-[11px] text-muted-foreground" dir="auto">
                        {[hit.hebrewDescription, hit.description].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </button>
                </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
