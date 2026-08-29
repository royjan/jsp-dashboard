'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'
import { MOBILE_PRIMARY, MOBILE_TREE, isItemActive, type NavItem } from '@/lib/navigation'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useRecentDestinations, recordDestination } from '@/lib/recent-destinations'
import { openCommandPalette } from '@/lib/command-palette'
import { ChevronLeft, Clock, X } from 'lucide-react'

/**
 * The phone's navigation: a fixed dock, a radial menu on the button in the
 * middle of it, and a sheet that drills in.
 *
 * WHY NOT A HAMBURGER. The four destinations people actually open stay on the
 * screen at all times, so the common case costs no discovery at all -- someone
 * who does not know what a menu is can still see where to press. The dock is
 * the floor; everything below is opt-in.
 *
 * WHY THE ORBIT. The button in the middle is the whole map, and it opens as six
 * labelled bubbles springing out over the page rather than as another list.
 * Two practical reasons on top of the obvious one: a 56px circle near the
 * bottom edge is the easiest target a thumb has, and a fixed layout gives the
 * hand somewhere to learn -- "purchasing is the far one on the left" is muscle
 * memory a scrolling list can never offer. Every bubble carries its name in
 * text; an icon on its own would put back exactly the guessing the dock avoids.
 *
 * WHY THE SHEET PUSHES INSTEAD OF FLATTENING. It used to render the tree
 * flattened -- every screen's tabs promoted to rows of their own, each needing
 * a "דוח עסקי › זיכויים" qualifier to not read as a sibling of "זיכויי ספקים" --
 * and seven of them opted out of the phone entirely rather than appear that
 * way. A second pane costs one transform and one back button, and pays for both
 * at once: the parent is the header, so the qualifier is structural instead of
 * repeated on every row, and the tabs that had opted out can come back.
 */

/**
 * The radial layout: two rows of three, gently arced, springing out of the
 * button.
 *
 * It was a real arc -- six bubbles at evenly spaced angles, radii alternating
 * so neighbours would not sit closer together than their labels are wide. That
 * fails at the bottom of the arc, which is where reading starts: the first
 * bubble ends up barely above the button, and a caption hung under it lands
 * behind the dock. Widening the arc to lift it pushes the outermost captions
 * past the edge of a 393pt screen instead.
 *
 * There is no arrangement of six labelled points on a ring that fits Hebrew
 * section names at this width, so the ring goes and the labels stay. Rows keep
 * every caption on screen and clear of the dock, and the middle column sits
 * higher than its neighbours, which is enough curve to read as a burst rather
 * than a grid.
 */
const ORBIT_COL_X = 118
const ORBIT_ROW_Y = [-110, -218] as const
/** How much higher the middle of each row sits. The whole of the curve. */
const ORBIT_ARC_LIFT = 16
const BUBBLE = 56
/** Half a bubble's caption, so a side column can be checked against the edge. */
const ORBIT_HALF_CAPTION = 52

function orbitOffset(i: number, scale: number, isRTL: boolean) {
  const row = Math.floor(i / 3)
  // Column +1 is where reading starts: the right in RTL, the left in LTR.
  const col = 1 - (i % 3)
  return {
    x: col * ORBIT_COL_X * scale * (isRTL ? 1 : -1),
    // Not scaled: vertical room is the one thing a phone has, and shrinking
    // this is what would put a caption back under the dock.
    y: ORBIT_ROW_Y[row] - (col === 0 ? ORBIT_ARC_LIFT : 0),
  }
}

/**
 * Shrink the constellation on narrow phones rather than letting the outer
 * captions run off the edge. The widest thing on screen is a side column plus
 * half its caption; 8px keeps it off the bezel.
 */
function useOrbitScale(): number {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const measure = () =>
      setScale(Math.min(1, (window.innerWidth / 2 - 8) / (ORBIT_COL_X + ORBIT_HALF_CAPTION)))
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return scale
}

export function MobileNav() {
  const pathname = usePathname()
  const { t, dir } = useLocale()
  const isRTL = dir === 'rtl'
  const scale = useOrbitScale()
  const moneyHidden = useMoneyHidden()
  const recents = useRecentDestinations()
  const sheetRef = useRef<HTMLDivElement>(null)

  const [orbitOpen, setOrbitOpen] = useState(false)
  const [sectionId, setSectionId] = useState<string | null>(null)
  /** The parent whose tabs the second pane is showing. */
  const [drillHref, setDrillHref] = useState<string | null>(null)

  const section = useMemo(() => MOBILE_TREE.find((s) => s.id === sectionId) ?? null, [sectionId])
  const drilled = useMemo(
    () => section?.items.find((i) => i.href === drillHref) ?? null,
    [section, drillHref],
  )
  const sheetOpen = section !== null
  const anyOpen = orbitOpen || sheetOpen

  // ── swipe down to dismiss ────────────────────────────────────────────────────────
  // A sheet you can only close with the X is a panel wearing a sheet's shape. Tracked
  // by hand rather than pulled in as a dependency: it is one pointer delta, and the
  // gesture must not fight the list's own scrolling -- so it only arms when the scroll
  // is already at the top, which is the same rule the OS sheets use.
  const drag = useRef<{ y: number; armed: boolean } | null>(null)
  const [dragY, setDragY] = useState(0)

  const closeAll = useCallback(() => {
    setOrbitOpen(false)
    setSectionId(null)
    setDrillHref(null)
    setDragY(0)
  }, [])

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
    if (dragY > 110) closeAll()
    setDragY(0)
    drag.current = null
  }

  // Whatever is open is a layer over the page; the page behind it must not scroll.
  useEffect(() => {
    if (!anyOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [anyOpen])

  // Escape backs out one level at a time -- a phone rarely has a key, but this
  // component also renders on a narrow desktop window, where a layer with no
  // keyboard exit is a trap and one that drops you all the way out is a chore.
  useEffect(() => {
    if (!anyOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (drillHref) setDrillHref(null)
      else if (sheetOpen) setSectionId(null)
      else closeAll()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anyOpen, drillHref, sheetOpen, closeAll])

  // Only page destinations. `recent-destinations` also records items, customers and
  // documents -- useful in ⌘K, noise in a navigation menu.
  const recentPages = recents.filter((r) => r.kind === 'page').slice(0, 4)

  const go = (item: NavItem, label: string, qualifier?: string) => {
    recordDestination({ href: item.href, label, sublabel: qualifier, kind: 'page' })
    closeAll()
  }

  /** One row of the sheet: a destination, or a parent that pushes the next pane. */
  const renderRow = (item: NavItem, qualifier?: string) => {
    const label = t(item.labelKey)
    const isActive = isItemActive(item, pathname, null)
    const Icon = item.icon
    // Demo mode drops /report's revenue tab, so the row for it goes too --
    // otherwise it is a link that silently lands on the summary instead.
    const kids = (item.children ?? []).filter((c) => !(c.demoHidden && moneyHidden))
    const body = (
      <>
        <span className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border',
          isActive ? 'border-transparent bg-primary/15 text-primary' : 'bg-muted/40 text-muted-foreground',
        )}>
          <Icon className="h-[17px] w-[17px]" />
        </span>
        <span className="flex-1 text-start leading-tight">
          {label}
          {kids.length > 0 && (
            <span className="block text-[10.5px] font-normal leading-tight text-muted-foreground">
              {kids.length === 1 ? t('navViewOne') : `${kids.length} ${t('navViewsCount')}`}
            </span>
          )}
        </span>
        {kids.length > 0 && (
          <ChevronLeft className={cn('h-4 w-4 shrink-0 text-muted-foreground', !isRTL && 'rotate-180')} />
        )}
      </>
    )
    // 48px, not 56: a one-column list of seven rows at 56 plus a gap filled the
    // whole sheet with air and made the section look longer than it is. 48 is
    // still over the 44px touch minimum.
    const cls = cn(
      'flex min-h-12 w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[14.5px] font-semibold',
      'transition-colors active:bg-muted',
      isActive ? 'bg-primary/10 text-primary' : 'text-foreground',
    )

    if (kids.length > 0) {
      return (
        <button key={item.href} type="button" className={cls} onClick={() => setDrillHref(item.href)}>
          {body}
        </button>
      )
    }
    // The one entry that is not a destination: smart search has no page any
    // more, so it opens the palette in place.
    if (item.action === 'command-palette') {
      return (
        <button key={item.href} type="button" className={cls} onClick={() => { closeAll(); openCommandPalette() }}>
          {body}
        </button>
      )
    }
    return (
      <Link key={item.href} href={item.href} className={cls} onClick={() => go(item, label, qualifier)}>
        {body}
      </Link>
    )
  }

  /** One dock tab. The four that matter, always on screen, never in a menu. */
  const tabs = MOBILE_PRIMARY
  const half = Math.ceil(tabs.length / 2)
  const renderTab = (item: NavItem) => {
    const isActive = isItemActive(item, pathname, null)
    const Icon = item.icon
    const label = t(item.labelKey)
    const cls = cn(
      'flex min-h-[54px] flex-col items-center justify-center gap-1 px-1 text-[11px] transition-colors',
      isActive ? 'text-primary' : 'text-muted-foreground',
    )
    const body = (
      <>
        <Icon className="h-5 w-5 shrink-0" />
        <span className="max-w-full truncate">{label}</span>
      </>
    )
    // Smart search is the one tab that is not a destination: there is no
    // /search page any more, so it opens the palette in place. A phone has no
    // ⌘K, which is exactly why the tab has to stay.
    return item.action === 'command-palette' ? (
      <button key={item.href} type="button" onClick={openCommandPalette} className={cls}>
        {body}
      </button>
    ) : (
      <Link key={item.href} href={item.href} className={cls} onClick={() => go(item, label)}>
        {body}
      </Link>
    )
  }

  return (
    <div data-print="hide" className="contents">
      {/* ── the radial menu ───────────────────────────────────────────────── */}
      <div
        className={cn('fixed inset-0 z-50 lg:hidden', !orbitOpen && 'pointer-events-none')}
        aria-hidden={!orbitOpen}
      >
        <div
          className={cn(
            'absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-300',
            orbitOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          onClick={closeAll}
        />
        {MOBILE_TREE.map((s, i) => {
          const { x, y } = orbitOffset(i, scale, isRTL)
          const Icon = s.icon
          return (
            <button
              key={s.id}
              type="button"
              tabIndex={orbitOpen ? 0 : -1}
              onClick={() => { setOrbitOpen(false); setSectionId(s.id); setDrillHref(null) }}
              style={{
                width: BUBBLE,
                height: BUBBLE,
                transform: orbitOpen
                  ? `translate(calc(-50% + ${x.toFixed(1)}px), ${y.toFixed(1)}px) scale(1)`
                  : 'translate(-50%, 0) scale(0.3)',
                transitionDelay: `${(orbitOpen ? i : MOBILE_TREE.length - i) * 35}ms`,
              }}
              className={cn(
                'absolute bottom-[calc(1.375rem+env(safe-area-inset-bottom))] left-1/2',
                'flex items-center justify-center rounded-full border bg-card text-foreground shadow-xl',
                'transition-[transform,opacity] duration-[450ms] [transition-timing-function:cubic-bezier(.34,1.56,.64,1)]',
                'motion-reduce:transition-none active:scale-95',
                orbitOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
              )}
            >
              <Icon className="h-[22px] w-[22px] text-primary" />
              {/* Always below, never above: a caption over a bubble reads as
                  belonging to the one in the row behind it. Two lines are
                  allowed -- "לקוחות ומכירות" truncated is worse than wrapped. */}
              <span className="absolute top-[calc(100%+5px)] w-[104px] rounded-lg border bg-background/95 px-1 py-0.5 text-center text-[11px] font-bold leading-tight">
                {t(s.labelKey)}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── the sheet ─────────────────────────────────────────────────────── */}
      {sheetOpen && section && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/60 transition-opacity"
            style={{ opacity: Math.max(0, 1 - dragY / 260) }}
            onClick={closeAll}
          />
          <div
            ref={sheetRef}
            className={cn(
              // ABOVE THE BAR. Anchoring at bottom-0 tucks the last row behind the
              // dock -- which is fixed, z-50 and painted after this, so it wins.
              'absolute inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] flex flex-col',
              'rounded-t-3xl border-t bg-background shadow-2xl',
              // Hugs its content, capped: a fixed height leaves a quarter of the
              // sheet empty on a short section, which reads as still loading.
              'max-h-[82vh]',
              !dragY && 'transition-transform duration-200',
            )}
            style={{ transform: `translateY(${dragY}px)` }}
          >
            {/* The grab area, and the only place a drag starts. Dragging from the
                list itself would make every scroll attempt feel like a dismissal. */}
            <div
              className="shrink-0 cursor-grab touch-none pb-1 pt-2 active:cursor-grabbing"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div className="mx-auto h-1 w-10 rounded-full bg-muted-foreground/30" />
            </div>

            <div className="flex shrink-0 items-center gap-2 border-b px-3 pb-3 pt-1">
              {drilled && (
                <button
                  type="button"
                  onClick={() => setDrillHref(null)}
                  aria-label={t('navBack')}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border active:bg-muted"
                >
                  <ChevronLeft className={cn('h-4 w-4', !isRTL && 'rotate-180')} />
                </button>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[17px] font-bold leading-tight">
                  {drilled ? t(drilled.labelKey) : t(section.labelKey)}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {drilled
                    ? t(section.labelKey)
                    : section.items.length === 1
                      ? t('navScreenOne')
                      : `${section.items.length} ${t('navScreensCount')}`}
                </div>
              </div>
              <button
                type="button"
                onClick={closeAll}
                aria-label={t('navCloseMenu')}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-muted-foreground active:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Two panes, one transform. The incoming pane enters from the side
                the language reads TOWARDS -- from the left in Hebrew -- because
                a push that arrives from the wrong edge reads as a step back. */}
            {/* The two panes share ONE grid cell, so the sheet is as tall as the
                taller of them and no taller. It used to be a flex-1 box holding
                an h-full pane, which grows to the 82vh cap whatever is in it --
                seven rows then sat in a sheet sized for fourteen, which is what
                made the list read as mostly empty space. */}
            <div className="grid overflow-hidden">
              <div
                data-sheet-scroll
                className={cn(
                  '[grid-area:1/1] max-h-[62vh] space-y-0.5 overflow-y-auto overscroll-contain px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
                  'transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none',
                  drilled && (isRTL ? 'pointer-events-none translate-x-[42%] opacity-0' : 'pointer-events-none -translate-x-[42%] opacity-0'),
                )}
              >
                {recentPages.length > 0 && !drilled && (
                  <div className="px-1 pb-1 pt-1">
                    <div className="flex items-center gap-1.5 px-2 pb-2 text-[11px] font-semibold text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {t('recentlyOpened')}
                    </div>
                    {/* Horizontal, so this row never pushes the section off the
                        screen however many entries it holds. */}
                    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {recentPages.map((r) => (
                        <Link
                          key={r.href}
                          href={r.href}
                          onClick={closeAll}
                          className="shrink-0 whitespace-nowrap rounded-full border bg-muted/40 px-3 py-2 text-xs active:bg-muted"
                        >
                          {r.label}
                        </Link>
                      ))}
                    </div>
                    <div className="mt-2 h-px bg-border" />
                  </div>
                )}
                {section.items.map((item) => renderRow(item))}
              </div>

              <div
                aria-hidden={!drilled}
                className={cn(
                  '[grid-area:1/1] max-h-[62vh] space-y-0.5 overflow-y-auto overscroll-contain px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
                  'transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none',
                  drilled
                    ? 'translate-x-0 opacity-100'
                    : cn('pointer-events-none opacity-0', isRTL ? '-translate-x-full' : 'translate-x-full'),
                )}
              >
                {/* The parent is a destination too -- /report's own row IS the
                    summary tab -- so it leads its own tab list rather than being
                    the one screen you cannot reach from here. */}
                {drilled && renderRow({ ...drilled, children: undefined }, t(section.labelKey))}
                {(drilled?.children ?? [])
                  .filter((c) => !(c.demoHidden && moneyHidden))
                  .map((c) => renderRow(c, drilled ? t(drilled.labelKey) : undefined))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── the dock ──────────────────────────────────────────────────────── */}
      <nav
        className="safe-area-bottom fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden"
        aria-label={t('navOpenMenu')}
      >
        <div className="grid h-16 grid-cols-5 items-center">
          {/* Two tabs, the gap the button in the middle occupies, two tabs.
              Splitting the list rather than laying out five equal slots keeps
              this correct if a fifth primary is ever added: it lands in a
              column, not on top of the button. */}
          {tabs.slice(0, half).map(renderTab)}
          <div aria-hidden />
          {tabs.slice(half).map(renderTab)}
        </div>
      </nav>

      {/* Above the dock in the stacking order and in the layout: it is the one
          control that opens everything, so it is the one that overlaps. */}
      <button
        type="button"
        onClick={() => (anyOpen ? closeAll() : setOrbitOpen(true))}
        aria-expanded={anyOpen}
        aria-label={anyOpen ? t('navCloseMenu') : t('navOpenMenu')}
        style={{ width: BUBBLE, height: BUBBLE }}
        className={cn(
          'fixed bottom-[calc(1.375rem+env(safe-area-inset-bottom))] left-1/2 z-[51] lg:hidden',
          'flex items-center justify-center rounded-[1.4rem] bg-primary text-primary-foreground shadow-lg shadow-primary/30',
          'transition-[transform,border-radius] duration-500 [transition-timing-function:cubic-bezier(.34,1.56,.64,1)]',
          'motion-reduce:transition-none',
          anyOpen ? '-translate-x-1/2 rotate-[135deg] rounded-full' : '-translate-x-1/2',
        )}
      >
        {/* Nine dots that read as "everything", and land on a clean X at 135deg. */}
        <span className="grid grid-cols-3 gap-1">
          {Array.from({ length: 9 }, (_, i) => (
            <span
              key={i}
              className={cn(
                'h-1.5 w-1.5 rounded-full bg-current transition-all duration-300',
                anyOpen && i % 2 === 1 && 'scale-50 opacity-30',
              )}
            />
          ))}
        </span>
      </button>
    </div>
  )
}
