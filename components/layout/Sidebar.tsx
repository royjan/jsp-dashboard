'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { DURATION, EASE } from '@/lib/motion'
import { useLocale } from '@/lib/locale-context'
import { sectionsFor, isItemActive, type NavItem, type NavSection } from '@/lib/navigation'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Warehouse } from 'lucide-react'
import { useUnacknowledgedCount } from '@/hooks/use-analytics'
import { usePersisted } from '@/hooks/use-persisted'

/**
 * The desktop navigation: a RAIL of six sections, and a flyout that opens on
 * the one you point at.
 *
 * It was a 224px column holding the whole tree. That column was permanently
 * subtracted from the charts -- the widest tables on this app already scroll --
 * to display, most of the time, five sections nobody was looking at. Collapsing
 * it to the 64px icon rail traded that back for a row of unlabelled glyphs and
 * a tooltip you had to wait for, which is the wrong trade for a tool used by
 * people who do not navigate by icon.
 *
 * So the rail keeps the label. 80px is enough for an icon over two lines of
 * Hebrew, which means every section is readable without hovering anything, and
 * the flyout carries the depth: the section's screens, and under any screen
 * that has them, its own tabs. The page gets 144px back and loses nothing.
 *
 * WHY THE THIRD LEVEL IS AN ACCORDION AND NOT A SECOND COLUMN. A cascading
 * column is the obvious shape and the wrong one here: the pointer has to cross
 * the gap between the panels to reach it, which is a diagonal it will leave the
 * parent row on unless a timer covers for it; it costs another 250px, so at
 * 1280px the flyout would sit over the content it is meant to help you leave;
 * and on the tablets this runs on there is no hover to open it with at all. The
 * accordion opens under the parent, keeps it on screen above its tabs, and is
 * the same gesture on a mouse and a finger.
 */

interface SidebarProps {
  /** Flyout held open beside the rail, and the page indented to clear it. */
  pinned: boolean
  onTogglePin: () => void
}

export const RAIL_WIDTH = 80
export const FLYOUT_WIDTH = 256

/**
 * Which section owns the current route.
 *
 * The exact nav match answers it for the 44 entries that are their own screen.
 * The rest of the app is detail routes with no entry of their own --
 * /suppliers/1234, /bookkeeping/journal/88, /customers/50012 -- and on those
 * the rail would otherwise light nothing at all, so fall back to the section
 * owning the longest href the pathname sits under.
 */
function sectionOfPath(
  sections: NavSection[],
  pathname: string,
  params: URLSearchParams | null,
): string | null {
  const hit = sections.find((s) =>
    s.items.some((i) => isItemActive(i, pathname, params) || subtreeHasActive(i, pathname, params)),
  )
  if (hit) return hit.id

  // Longest own-path match, which also covers the queryMatch entries while the
  // search params are still suspending: /report is not "active" then, but it is
  // still the page you are on.
  let best: string | null = null
  let bestLen = 0
  for (const section of sections) {
    for (const item of [...section.items, ...section.items.flatMap((i) => i.children ?? [])]) {
      const href = (item.matchHref ?? item.href).split('?')[0]
      const owns = href !== '/' && (pathname === href || pathname.startsWith(`${href}/`))
      if (owns && href.length > bestLen) {
        best = section.id
        bestLen = href.length
      }
    }
  }
  return best
}

/** Is the current route one of this item's tabs? */
function subtreeHasActive(
  item: NavItem,
  pathname: string,
  params: URLSearchParams | null,
): boolean {
  return (item.children ?? []).some((c) => isItemActive(c, pathname, params))
}

/**
 * Hover opens the flyout, but only where hovering is a thing.
 *
 * On a touchscreen the first tap on a rail button fires the hover handlers and
 * the click together, so a hover-opened flyout would open and then immediately
 * be dismissed by the outside-tap that the same gesture also looks like. Tablets
 * in landscape are wide enough to get this sidebar, so this is not theoretical.
 */
function useHoverCapable(): boolean {
  const [ok, setOk] = useState(true)
  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)')
    const apply = () => setOk(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  return ok
}

function SidebarShell({
  pinned, onTogglePin, params,
}: SidebarProps & { params: URLSearchParams | null }) {
  const pathname = usePathname()
  const { t, dir } = useLocale()
  const isRTL = dir === 'rtl'
  const reduce = useReducedMotion()
  const hoverCapable = useHoverCapable()
  const { data: unackCount } = useUnacknowledgedCount()
  const moneyHidden = useMoneyHidden()

  const sections = sectionsFor('sidebar')
  const activeSectionId = sectionOfPath(sections, pathname, params)

  /**
   * Two ids, because pinned and unpinned are different questions.
   *
   * Unpinned, the flyout is a transient answer to "what is under this one" and
   * dies with the pointer -- persisting it would mean reloading the page into a
   * panel nobody asked for. Pinned, it is a column you chose to keep, so it
   * survives the reload; `null` there still means "follow the route", which is
   * what makes the server paint already show the right section.
   */
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [pinnedId, setPinnedId] = usePersisted<string | null>('ui.sidebar.openSection', null)
  const shownId = pinned ? (pinnedId ?? activeSectionId) : hoverId
  const shown = sections.find((s) => s.id === shownId) ?? null

  // Follow the route while pinned: navigating out of the open section must move
  // the column with you, or the one thing the rail has to answer -- where am I
  // -- is answered by a panel showing somewhere else.
  useEffect(() => {
    if (pinned && activeSectionId) setPinnedId(activeSectionId)
  }, [pinned, activeSectionId, setPinnedId])

  const open = useCallback(
    (id: string | null) => (pinned ? setPinnedId(id) : setHoverId(id)),
    [pinned, setPinnedId],
  )

  /**
   * Open and close are both delayed, for opposite reasons. Opening waits out a
   * pointer that is only crossing the rail on its way somewhere else, so the
   * panel does not strobe through six sections. Closing waits out the gap
   * between the rail and the flyout, which the pointer is briefly over neither.
   */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const schedule = useCallback((fn: () => void, ms: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(fn, ms)
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const hoverOpen = (id: string) => { if (hoverCapable && !pinned) schedule(() => setHoverId(id), 90) }
  const hoverClose = () => { if (!pinned) schedule(() => setHoverId(null), 160) }
  const cancelClose = () => { if (timer.current) clearTimeout(timer.current) }

  /**
   * The third level, one open at a time, on a two-empty-values scheme: `null`
   * is "the user has not chosen" and falls back to the route, so the tabs of
   * the screen you are on are already showing; `''` is "the user closed it" and
   * has to survive, or clicking the open parent would fall back and reopen it
   * on the spot.
   */
  const [openTabsOf, setOpenTabsOf] = usePersisted<string | null>('ui.sidebar.openTabs', null)

  // Being ON the parent counts, not just on one of its tabs: /report's own row
  // IS the summary tab, so landing there must still reveal the other six. The
  // pathname clause carries the queryMatch entries (/report, /chat/diego)
  // through the render where the search params are still suspending.
  const routeParent = sections
    .flatMap((s) => s.items)
    .find(
      (i) =>
        (i.children?.length ?? 0) > 0 &&
        (isItemActive(i, pathname, params) ||
          subtreeHasActive(i, pathname, params) ||
          pathname === (i.matchHref ?? i.href).split('?')[0]),
    )?.href ?? null
  const expandedTabsOf = openTabsOf === null ? routeParent : openTabsOf

  useEffect(() => {
    if (routeParent) setOpenTabsOf(routeParent)
  }, [routeParent, setOpenTabsOf])

  /**
   * Unacknowledged customer feedback is the only count on the tree today, but a
   * rail whose flyout is closed must not swallow what its rows were shouting
   * about -- so the rail button rolls up whatever this returns rather than
   * knowing about /customers itself.
   */
  const badgeOf = (item: NavItem): number | undefined =>
    item.href === '/customers' && typeof unackCount === 'number' && unackCount > 0
      ? unackCount
      : undefined

  const railRefs = useRef<Array<HTMLButtonElement | null>>([])

  const railKeys = (i: number) => (e: React.KeyboardEvent) => {
    const n = sections.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
      railRefs.current[next]?.focus()
      open(sections[next].id)
    }
    if (e.key === 'Escape') { e.preventDefault(); setHoverId(null) }
  }

  /** A screen's own tab. No icon: seven more glyphs in a 256px column is noise,
   *  and the indent under the parent already says what these are. */
  const renderChild = (child: NavItem) => (
    <Link
      key={child.href}
      href={child.href}
      onClick={() => !pinned && setHoverId(null)}
      className={cn(
        'flex items-center rounded-md px-3 py-1.5 text-[13px] transition-colors',
        isItemActive(child, pathname, params)
          ? 'bg-primary font-semibold text-primary-foreground'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <span className="truncate">{t(child.labelKey)}</span>
    </Link>
  )

  const renderItem = (item: NavItem) => {
    const isActive = isItemActive(item, pathname, params)
    const Icon = item.icon
    const badge = badgeOf(item)
    // Demo mode drops /report's revenue tab, so the row for it goes too.
    const children = (item.children ?? []).filter((c) => !(c.demoHidden && moneyHidden))
    const hasChildren = children.length > 0
    const tabsOpen = hasChildren && expandedTabsOf === item.href
    const holdsActive = subtreeHasActive(item, pathname, params)

    const link = (
      <Link
        href={item.href}
        onClick={() => !pinned && setHoverId(null)}
        className={cn(
          'flex min-h-9 flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-primary text-primary-foreground'
            : holdsActive
              // Not where you are, but what you are inside.
              ? 'bg-accent/60 text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate">{t(item.labelKey)}</span>
        {badge && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground">
            {badge}
          </span>
        )}
      </Link>
    )

    if (!hasChildren) return <div key={item.href}>{link}</div>

    return (
      <div key={item.href}>
        <div className="flex items-center gap-0.5">
          {link}
          {/* A separate control, not part of the link: opening a screen's tabs
              and going to that screen are two different intentions, and the
              second one should still be one click from anywhere. */}
          <button
            type="button"
            onClick={() => setOpenTabsOf(tabsOpen ? '' : item.href)}
            aria-expanded={tabsOpen}
            aria-label={`${t(item.labelKey)} — ${children.length} ${t('navViewsCount')}`}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', !tabsOpen && (isRTL ? 'rotate-90' : '-rotate-90'))} />
          </button>
        </div>
        {/* grid-template-rows 0fr -> 1fr animates to the content's real height,
            which a max-height guess cannot do without clipping a long parent or
            leaving a gap under a short one. */}
        <div className={cn('grid transition-[grid-template-rows] duration-200 ease-out', tabsOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
          <div className="overflow-hidden">
            {/* The guide line carries the eye back to the parent; without it a
                tab row reads as a sibling that happens to be indented. */}
            <div className="ms-5 mt-0.5 space-y-0.5 border-s border-border/70 ps-2">
              {children.map(renderChild)}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const flyout = shown && (
    <div
      className="flex h-full flex-col border-e bg-card"
      style={{ width: FLYOUT_WIDTH }}
      onMouseEnter={cancelClose}
      onMouseLeave={hoverClose}
    >
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <span className="truncate text-sm font-bold">{t(shown.labelKey)}</span>
        <span className="ms-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {shown.items.length} {t('navScreensCount')}
        </span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">{shown.items.map(renderItem)}</nav>
    </div>
  )

  return (
    <div
      data-print="hide"
      className="fixed inset-y-0 start-0 z-40 hidden lg:flex"
      onMouseLeave={hoverClose}
    >
      <aside
        className="flex h-screen flex-col border-e bg-card"
        style={{ width: RAIL_WIDTH }}
        aria-label={t('navOpenMenu')}
      >
        <Link href="/" className="flex h-14 shrink-0 items-center justify-center border-b" aria-label="Jan Parts">
          <Warehouse className="h-6 w-6 text-primary" />
        </Link>

        <nav className="flex-1 space-y-1 overflow-y-auto p-1.5">
          {sections.map((section, i) => {
            const isShown = shownId === section.id
            const holdsActive = section.id === activeSectionId
            const rolledUp = section.items.reduce((sum, item) => sum + (badgeOf(item) ?? 0), 0)
            const Icon = section.icon
            return (
              <button
                key={section.id}
                ref={(el) => { railRefs.current[i] = el }}
                type="button"
                aria-expanded={isShown}
                aria-haspopup="true"
                onClick={() => open(isShown && !pinned ? null : section.id)}
                onMouseEnter={() => hoverOpen(section.id)}
                onFocus={() => open(section.id)}
                onKeyDown={railKeys(i)}
                className={cn(
                  'relative flex w-full flex-col items-center justify-center gap-1 rounded-xl px-1 py-2.5',
                  'min-h-[58px] text-[10px] font-semibold leading-tight transition-colors',
                  isShown || holdsActive
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                {/* Where you are, at the only level the rail can show it. */}
                {holdsActive && (
                  <span className="absolute end-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-full bg-primary" />
                )}
                <span className="relative">
                  {<Icon className={cn('h-[22px] w-[22px]', holdsActive && 'text-primary')} />}
                  {rolledUp > 0 && (
                    <span className="absolute -end-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-destructive-foreground">
                      {rolledUp}
                    </span>
                  )}
                </span>
                <span className="line-clamp-2 w-full text-center">{t(section.labelKey)}</span>
              </button>
            )
          })}
        </nav>

        <div className="shrink-0 border-t p-1.5">
          <button
            type="button"
            onClick={onTogglePin}
            aria-pressed={pinned}
            aria-label={pinned ? t('navUnpin') : t('navPin')}
            title={pinned ? t('navUnpin') : t('navPin')}
            className={cn(
              'flex min-h-11 w-full items-center justify-center rounded-xl transition-colors',
              pinned ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
            )}
          >
            {pinned
              ? <PanelLeftClose className={cn('h-4 w-4', isRTL && 'rotate-180')} />
              : <PanelLeftOpen className={cn('h-4 w-4', isRTL && 'rotate-180')} />}
          </button>
        </div>
      </aside>

      {/* Pinned, the flyout is part of the layout and must not animate on every
          route change; unpinned it is a layer over the page and its exit is the
          only thing telling you it was a layer. */}
      {pinned ? flyout : (
        <AnimatePresence>
          {shown && (
            <motion.div
              key="flyout"
              className="h-full shadow-2xl"
              initial={reduce ? { opacity: 0 } : { opacity: 0, x: isRTL ? 12 : -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, x: isRTL ? 12 : -12 }}
              transition={{ duration: DURATION.fast, ease: EASE }}
            >
              {flyout}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  )
}

/**
 * The nav reads useSearchParams (needed to tell the Diego and Dora entries
 * apart -- they share a pathname), which forces a Suspense boundary during
 * prerender. The boundary lives here rather than around <Sidebar> in app-shell
 * so the shell stays untouched and the fallback is the same markup with no
 * query awareness.
 */
function SidebarWithParams(props: SidebarProps) {
  const params = useSearchParams()
  return <SidebarShell {...props} params={params} />
}

export function Sidebar(props: SidebarProps) {
  return (
    <Suspense fallback={<SidebarShell {...props} params={null} />}>
      <SidebarWithParams {...props} />
    </Suspense>
  )
}
