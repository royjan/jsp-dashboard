'use client'

import { Suspense, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'
import { sectionsFor, isItemActive, type NavItem, type NavSection } from '@/lib/navigation'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { ChevronDown, ChevronLeft, Warehouse } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useUnacknowledgedCount } from '@/hooks/use-analytics'
import { usePersisted } from '@/hooks/use-persisted'



interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

/**
 * The nav list, split out because it reads useSearchParams (needed to tell the
 * Diego and Dora entries apart -- they share a pathname). That hook forces a
 * Suspense boundary during prerender, and the boundary is kept in here rather
 * than around <Sidebar> in app-shell so the shell stays untouched and the
 * fallback can be the same markup with no query awareness.
 */
function SidebarNav({ collapsed, isRTL }: { collapsed: boolean; isRTL: boolean }) {
  const params = useSearchParams()
  return <SidebarNavList collapsed={collapsed} isRTL={isRTL} params={params} />
}

/**
 * Which section owns the current route.
 *
 * The exact nav match answers it for the 44 entries that are their own screen.
 * The rest of the app is detail routes with no entry of their own --
 * /suppliers/1234, /bookkeeping/journal/88, /customers/50012 -- and on those
 * the tree would otherwise stay open wherever it happened to be, so fall back
 * to the section owning the longest href the pathname sits under.
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

function SidebarNavList({
  collapsed, isRTL, params,
}: { collapsed: boolean; isRTL: boolean; params: URLSearchParams | null }) {
  const pathname = usePathname()
  const { t } = useLocale()
  const { data: unackCount } = useUnacknowledgedCount()

  const sections = sectionsFor('sidebar')
  const activeSectionId = sectionOfPath(sections, pathname, params)

  /**
   * One section expanded at a time.
   *
   * All six used to be open at once: 44 rows in a column that fits ~28, so
   * bookkeeping and chat sat below the fold permanently and every navigation
   * began by scrolling and scanning rows of identical weight. Collapsed, the
   * same tree is six headers plus the section you are in.
   *
   * The rail (`collapsed`) is deliberately exempt -- it has no headers to
   * click, so hiding items there would make them unreachable.
   */
  const [openId, setOpenId] = usePersisted<string | null>('ui.sidebar.openSection', null)

  /**
   * Two empty values, deliberately. `null` is "the user has not chosen", and
   * falls back to the route -- which is what makes the SERVER-rendered paint
   * already show the right section open; keying only off stored state renders
   * six closed headers until hydration runs the effect below. `''` is "the
   * user closed it", and must survive, or clicking the open header would set
   * null and the fallback would reopen it on the spot.
   */
  const expandedId = openId === null ? activeSectionId : openId

  // Follow the route: landing in a section opens it. Without this the active
  // row can end up inside a closed header, and the one thing the sidebar must
  // always answer is where you are.
  useEffect(() => {
    if (activeSectionId) setOpenId(activeSectionId)
  }, [activeSectionId, setOpenId])

  /**
   * The third level, one open at a time, on the same two-empty-values scheme
   * as the sections above: the tabs of the screen you are on are showing
   * before you touch anything, and any other parent can be opened by its
   * chevron without navigating there first.
   */
  const [openTabsOf, setOpenTabsOf] = usePersisted<string | null>('ui.sidebar.openTabs', null)
  const moneyHidden = useMoneyHidden()

  // Being ON the parent counts, not just on one of its tabs: /report's own row
  // IS the summary tab, so landing there must still reveal the other six. The
  // pathname clause carries the queryMatch entries (/report, /chat/diego)
  // through the render where the search params are still suspending and
  // isItemActive cannot answer yet.
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
   * Unacknowledged customer feedback is the only count on the tree today, but
   * a closed section must not swallow what its rows were shouting about -- so
   * the header rolls up whatever this returns rather than knowing about
   * /customers itself.
   */
  const badgeOf = (item: NavItem): number | undefined =>
    item.href === '/customers' && typeof unackCount === 'number' && unackCount > 0
      ? unackCount
      : undefined

  /**
   * A tab row. Deliberately not the parent's shape: no icon (seven more icons
   * in a 224px column is noise, and the indent already says what these are),
   * smaller text, and the same solid pill when active -- the pill is always
   * exactly where you are, at whichever level.
   */
  const renderChild = (child: NavItem) => (
    <Link
      key={child.href}
      href={child.href}
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
    const hasChildren = children.length > 0 && !collapsed
    const tabsOpen = hasChildren && expandedTabsOf === item.href
    const holdsActive = subtreeHasActive(item, pathname, params)

    const link = (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors relative',
          isActive
            ? 'bg-primary text-primary-foreground'
            : holdsActive
              // Not where you are, but what you are inside.
              ? 'bg-accent/60 text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          hasChildren ? 'flex-1' : '',
          collapsed && 'justify-center px-2'
        )}
      >
        <span className="relative">
          <Icon className="h-4 w-4 shrink-0" />
          {badge && collapsed && (
            <span className="absolute -top-1 -end-1 h-2 w-2 rounded-full bg-destructive" />
          )}
        </span>
        {!collapsed && (
          <span className="flex items-center gap-2">
            {t(item.labelKey)}
            {badge && (
              <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold leading-none">
                {badge}
              </span>
            )}
          </span>
        )}
      </Link>
    )

    if (collapsed) {
      return (
        <Tooltip key={item.href}>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side={isRTL ? 'left' : 'right'}>{t(item.labelKey)}</TooltipContent>
        </Tooltip>
      )
    }
    if (!hasChildren) return link

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
            aria-label={t(item.labelKey)}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform',
                !tabsOpen && (isRTL ? 'rotate-90' : '-rotate-90'),
              )}
            />
          </button>
        </div>
        {tabsOpen && (
          // The guide line carries the eye back to the parent; without it a
          // tab row reads as a sibling that happens to be indented.
          <div className="ms-5 mt-0.5 space-y-0.5 border-s border-border/70 ps-2">
            {children.map(renderChild)}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      {sections.map((section, si) => {
        const isOpen = collapsed || expandedId === section.id
        const holdsActive = section.id === activeSectionId
        const rolledUp = isOpen
          ? 0
          : section.items.reduce((sum, item) => sum + (badgeOf(item) ?? 0), 0)

        return (
          <div
            key={section.id}
            className={cn(si > 0 && (collapsed ? 'mt-3 border-t border-border/60 pt-3' : 'mt-0.5'))}
          >
            {!collapsed && (
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? '' : section.id)}
                aria-expanded={isOpen}
                className={cn(
                  // No uppercase and no letter-spacing: neither does anything
                  // for Hebrew but push the glyphs apart at 10px.
                  'flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold',
                  'transition-colors hover:bg-accent',
                  isOpen ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform',
                    !isOpen && (isRTL ? 'rotate-90' : '-rotate-90'),
                  )}
                />
                <span className="flex-1 truncate text-start">{t(section.labelKey)}</span>
                {rolledUp > 0 && (
                  <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-destructive-foreground">
                    {rolledUp}
                  </span>
                )}
                {/* Where you are, while the section holding it is closed. */}
                {holdsActive && !isOpen && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                )}
                <span className="text-[10px] tabular-nums text-muted-foreground/50">
                  {section.items.length}
                </span>
              </button>
            )}
            {isOpen && <div className="space-y-1 pb-1">{section.items.map(renderItem)}</div>}
          </div>
        )
      })}
    </>
  )
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { dir } = useLocale()
  const isRTL = dir === 'rtl'

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        data-print="hide"
        className={cn(
          'fixed top-0 start-0 z-40 h-screen border-e bg-card transition-all duration-300 hidden lg:flex flex-col',
          collapsed ? 'w-16' : 'w-56'
        )}
      >
        <div className="flex h-14 items-center border-b px-4">
          {!collapsed && (
            <Link href="/" className="flex items-center gap-2 font-bold text-lg">
              <Warehouse className="h-6 w-6 text-primary" />
              <span>Jan Parts</span>
            </Link>
          )}
          {collapsed && (
            <Link href="/" className="mx-auto">
              <Warehouse className="h-6 w-6 text-primary" />
            </Link>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto p-2">
          <Suspense fallback={<SidebarNavList collapsed={collapsed} isRTL={isRTL} params={null} />}>
            <SidebarNav collapsed={collapsed} isRTL={isRTL} />
          </Suspense>
        </nav>

        <div className="border-t p-2">
          <Button variant="ghost" size="icon" onClick={onToggle} className="w-full">
            <ChevronLeft className={cn(
              'h-4 w-4 transition-transform',
              collapsed && !isRTL && 'rotate-180',
              !collapsed && isRTL && 'rotate-180',
            )} />
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  )
}
