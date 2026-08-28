'use client'

import { Suspense, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'
import { sectionsFor, isItemActive, type NavItem, type NavSection } from '@/lib/navigation'
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
  const hit = sections.find((s) => s.items.some((i) => isItemActive(i, pathname, params)))
  if (hit) return hit.id

  let best: string | null = null
  let bestLen = 0
  for (const section of sections) {
    for (const item of section.items) {
      const href = (item.matchHref ?? item.href).split('?')[0]
      if (href !== '/' && pathname.startsWith(`${href}/`) && href.length > bestLen) {
        best = section.id
        bestLen = href.length
      }
    }
  }
  return best
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
   * Unacknowledged customer feedback is the only count on the tree today, but
   * a closed section must not swallow what its rows were shouting about -- so
   * the header rolls up whatever this returns rather than knowing about
   * /customers itself.
   */
  const badgeOf = (item: NavItem): number | undefined =>
    item.href === '/customers' && typeof unackCount === 'number' && unackCount > 0
      ? unackCount
      : undefined

  const renderItem = (item: NavItem) => {
    const isActive = isItemActive(item, pathname, params)
    const Icon = item.icon
    const badge = badgeOf(item)

    const link = (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors relative',
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
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
    return link
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
