'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'
import { MOBILE_PRIMARY, MOBILE_MORE, MOBILE_MORE_SECTIONS, isItemActive } from '@/lib/navigation'
import { useRecentDestinations, recordDestination } from '@/lib/recent-destinations'
import { openCommandPalette } from '@/lib/command-palette'
import { ChevronLeft, Clock, MoreHorizontal } from 'lucide-react'

/**
 * The phone's navigation.
 *
 * THE SHEET USED TO BE A FLAT GRID OF 48 ICONS. `MOBILE_MORE` is `itemsFor('mobile')`,
 * and `itemsFor` exists to throw the section tree away — so the surface with the least
 * room to make sense of forty-eight destinations was the one rendering them with no
 * headings at all, while the sidebar showed the identical tree grouped. The grouping was
 * never missing. Mobile was the only surface discarding it.
 *
 * So the sheet reads `MOBILE_MORE_SECTIONS` instead, and shows the six sections as an
 * accordion: the whole map fits one screen, with a count against each, and opening one
 * closes the others. That last part is the point — a scroll through 48 rows tells you
 * where you are but never what exists.
 */

/**
 * One section open at a time, defaulting to the one you are already in.
 *
 * DERIVED, NOT SYNCED. The obvious shape — `useState(current)` plus an effect that
 * re-aims it whenever the sheet opens — is a setState inside an effect, which this repo
 * lints against and which costs a cascading render on every open. Instead `null` means
 * "follow the route": the default stays live with no effect at all, and closing the
 * sheet resets to null so reopening it lands on wherever you have since navigated.
 * An empty string is a real value, distinct from null — it means every section collapsed.
 */
function useOpenSection(pathname: string) {
  const current = useMemo(() => {
    const hit = MOBILE_MORE_SECTIONS.find((s) =>
      s.items.some((i) => isItemActive(i, pathname, null)))
    return hit?.id ?? MOBILE_MORE_SECTIONS[0]?.id ?? ''
  }, [pathname])

  const [override, setOverride] = useState<string | null>(null)
  return { openId: override ?? current, setOverride }
}

export function MobileNav() {
  const pathname = usePathname()
  const { t } = useLocale()
  const [showMore, setShowMore] = useState(false)
  const { openId, setOverride } = useOpenSection(pathname)
  const recents = useRecentDestinations()
  const sheetRef = useRef<HTMLDivElement>(null)

  // Was `href === pathname`, so /bookkeeping/vat left the More tab unlit.
  const isMoreActive = MOBILE_MORE.some((item) => isItemActive(item, pathname, null))

  // ── swipe down to dismiss ────────────────────────────────────────────────────────
  // A sheet you can only close with the X is a panel wearing a sheet's shape. Tracked
  // by hand rather than pulled in as a dependency: it is one pointer delta, and the
  // gesture must not fight the list's own scrolling — so it only arms when the scroll
  // is already at the top, which is the same rule the OS sheets use.
  const drag = useRef<{ y: number; armed: boolean } | null>(null)
  const [dragY, setDragY] = useState(0)

  function onPointerDown(e: React.PointerEvent) {
    const scroller = sheetRef.current?.querySelector('[data-sheet-scroll]')
    drag.current = { y: e.clientY, armed: (scroller?.scrollTop ?? 0) <= 0 }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current?.armed) return
    const dy = e.clientY - drag.current.y
    if (dy > 0) setDragY(dy)
  }
  function onPointerUp() {
    // A third of the way down is the commit point; anything less springs back, so a
    // half-hearted drag never loses the menu.
    if (dragY > 110) closeSheet()
    setDragY(0)
    drag.current = null
  }

  const closeSheet = useCallback(() => {
    setShowMore(false)
    setDragY(0)
    // Back to following the route, so the next open aims at wherever we ended up.
    setOverride(null)
  }, [setOverride])

  // The sheet is a layer over the page; the page behind it must not scroll with it.
  useEffect(() => {
    if (!showMore) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [showMore])

  // Escape closes it — a phone rarely has a key, but this component also renders on a
  // narrow desktop window, where a sheet with no keyboard exit is a trap.
  useEffect(() => {
    if (!showMore) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSheet() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showMore, closeSheet])

  // Only page destinations. `recent-destinations` also records items, customers and
  // documents — useful in ⌘K, noise in a navigation menu.
  const recentPages = recents.filter((r) => r.kind === 'page').slice(0, 4)

  return (
    <div data-print="hide" className="contents">
      {showMore && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/60 transition-opacity"
            style={{ opacity: Math.max(0, 1 - dragY / 260) }}
            onClick={closeSheet}
          />
          <div
            ref={sheetRef}
            className={cn(
              // ABOVE THE BAR, as the original panel was. Anchoring at bottom-0 tucks the
              // last section behind the nav — which is fixed, z-50 and painted after this,
              // so it wins — and the sixth category simply vanished.
              'absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] flex flex-col',
              'bg-background border-t rounded-t-2xl shadow-2xl',
              // HUGS ITS CONTENT, capped. A fixed 86vh left a quarter of the sheet empty
              // whenever the open section was a short one, which reads as a loading state
              // rather than a menu that has finished.
              'max-h-[86vh]',
              !dragY && 'transition-transform duration-200',
            )}
            style={{ transform: `translateY(${dragY}px)` }}
          >
            {/* The grab area, and the only place a drag starts. Dragging from the list
                itself would make every attempt to scroll feel like a dismissal. */}
            <div
              className="shrink-0 pt-2 pb-1 cursor-grab active:cursor-grabbing touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div className="mx-auto h-1 w-10 rounded-full bg-muted-foreground/30" />
            </div>

            <div
              data-sheet-scroll
              className="flex-1 overflow-y-auto overscroll-contain px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            >
              {recentPages.length > 0 && (
                <div className="px-1 pb-2">
                  <div className="flex items-center gap-1.5 px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {t('recentlyOpened')}
                  </div>
                  {/* Horizontal, because the point of this row is that it never pushes
                      the sections off the screen however many entries it holds. */}
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {recentPages.map((r) => (
                      <Link
                        key={r.href}
                        href={r.href}
                        onClick={closeSheet}
                        className="shrink-0 rounded-full border bg-muted/40 px-3 py-2 text-xs whitespace-nowrap active:bg-muted"
                      >
                        {r.label}
                      </Link>
                    ))}
                  </div>
                  <div className="mt-2 h-px bg-border" />
                </div>
              )}

              {MOBILE_MORE_SECTIONS.map((section) => {
                const isOpen = openId === section.id
                const hasActive = section.items.some((i) => isItemActive(i, pathname, null))
                return (
                  <div key={section.id}>
                    <button
                      type="button"
                      onClick={() => setOverride(isOpen ? '' : section.id)}
                      aria-expanded={isOpen}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-start text-[15px] font-semibold min-h-11',
                        'active:bg-muted transition-colors',
                        isOpen || hasActive ? 'text-primary' : 'text-foreground',
                      )}
                    >
                      {/* ChevronLeft, not Right: the sheet is RTL, so the collapsed arrow
                          has to point at the text it opens. */}
                      <ChevronLeft
                        className={cn(
                          'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
                          isOpen && '-rotate-90',
                        )}
                      />
                      <span className="flex-1">{t(section.labelKey)}</span>
                      <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                        {section.items.length}
                      </span>
                    </button>

                    {/* grid-template-rows 0fr -> 1fr animates to the content's real height,
                        which a max-height guess cannot do without clipping a long section
                        or leaving a gap under a short one. */}
                    <div
                      className={cn(
                        'grid transition-[grid-template-rows] duration-200 ease-out',
                        isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                      )}
                    >
                      <div className="overflow-hidden">
                        <div className="grid grid-cols-2 gap-1.5 px-1 pb-2 pt-0.5">
                          {section.items.map((item) => {
                            const isActive = isItemActive(item, pathname, null)
                            const Icon = item.icon
                            const label = t(item.labelKey)
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => {
                                  recordDestination({
                                    href: item.href,
                                    label,
                                    sublabel: item.qualifierKey ? t(item.qualifierKey) : undefined,
                                    kind: 'page',
                                  })
                                  closeSheet()
                                }}
                                className={cn(
                                  'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] min-h-11',
                                  'bg-muted/40 active:bg-muted transition-colors',
                                  isActive ? 'text-primary bg-primary/10' : 'text-foreground',
                                )}
                              >
                                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                                {/* The label wraps to two lines rather than truncating:
                                    "אינטליגנציית רכב" and "מחירוני ספקים" are both
                                    unreadable cut at one line in a half-width cell. */}
                                <span className="leading-tight line-clamp-2">{label}</span>
                              </Link>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden safe-area-bottom">
        <div className="flex items-center justify-around h-14">
          {MOBILE_PRIMARY.map((item) => {
            const isActive = isItemActive(item, pathname, null)
            const Icon = item.icon
            const tabClass = cn(
              'flex flex-col items-center justify-center gap-0.5 text-[11px] transition-colors min-h-[44px] px-1 flex-1 min-w-0',
              isActive ? 'text-primary' : 'text-muted-foreground'
            )
            const body = (
              <>
                <Icon className="h-5 w-5 shrink-0" />
                <span className="truncate max-w-full">{t(item.labelKey)}</span>
              </>
            )
            // Smart search is the one tab that is not a destination: there is no
            // /search page any more, so it opens the palette in place. A phone
            // has no ⌘K, which is exactly why the tab has to stay.
            return item.action === 'command-palette' ? (
              <button key={item.href} type="button" onClick={openCommandPalette} className={tabClass}>
                {body}
              </button>
            ) : (
              <Link key={item.href} href={item.href} className={tabClass}>
                {body}
              </Link>
            )
          })}
          <button
            onClick={() => (showMore ? closeSheet() : setShowMore(true))}
            aria-expanded={showMore}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 text-[11px] transition-colors min-h-[44px] px-1 flex-1 min-w-0',
              isMoreActive || showMore ? 'text-primary' : 'text-muted-foreground'
            )}
          >
            <MoreHorizontal className="h-5 w-5 shrink-0" />
            <span className="truncate max-w-full">{t('more') || 'More'}</span>
          </button>
        </div>
      </nav>
    </div>
  )
}
