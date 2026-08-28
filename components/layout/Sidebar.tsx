'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'
import { sectionsFor, isItemActive, type NavItem } from '@/lib/navigation'
import { ChevronLeft, Warehouse } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useUnacknowledgedCount } from '@/hooks/use-analytics'



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

function SidebarNavList({
  collapsed, isRTL, params,
}: { collapsed: boolean; isRTL: boolean; params: URLSearchParams | null }) {
  const pathname = usePathname()
  const { t } = useLocale()
  const { data: unackCount } = useUnacknowledgedCount()

  const renderItem = (item: NavItem) => {
    const isActive = isItemActive(item, pathname, params)
    const Icon = item.icon
    const showBadge =
      item.href === '/customers' &&
      typeof unackCount === 'number' &&
      unackCount > 0

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
          {showBadge && collapsed && (
            <span className="absolute -top-1 -end-1 h-2 w-2 rounded-full bg-destructive" />
          )}
        </span>
        {!collapsed && (
          <span className="flex items-center gap-2">
            {t(item.labelKey)}
            {showBadge && (
              <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold leading-none">
                {unackCount}
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
      {sectionsFor('sidebar').map((section, si) => (
        <div key={section.id} className={cn(si > 0 && 'mt-3 border-t border-border/60 pt-3')}>
          {!collapsed && (
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {t(section.labelKey)}
            </p>
          )}
          <div className="space-y-1">
            {section.items.map(renderItem)}
          </div>
        </div>
      ))}
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
