'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'
import type { TranslationKey } from '@/lib/i18n'
import {
  LayoutDashboard,
  Sun,
  Warehouse,
  ChevronLeft,
  Users,
  FileBarChart,
  Trash2,
  Receipt,
  SearchX,
  TrendingDown,
  ShoppingCart,
  RotateCcw,
  CarFront,
  Bell,
  DollarSign,
  Percent,
  Sparkles,
  Truck,
  Briefcase,
  PackageCheck,
  Container,
  GitBranch,
  Languages,
  Activity,
  MessagesSquare,
  Bot,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useUnacknowledgedCount } from '@/hooks/use-analytics'

type NavItem = { href: string; labelKey: TranslationKey; icon: typeof LayoutDashboard }

const navSections: Array<{ id: string; labelKey: TranslationKey; items: NavItem[] }> = [
  {
    id: 'overview', labelKey: 'sectionOverview', items: [
      { href: '/', labelKey: 'overview', icon: LayoutDashboard },
      { href: '/search', labelKey: 'smartSearch', icon: Sparkles },
      { href: '/seasonal', labelKey: 'seasonal', icon: Sun },
      { href: '/report', labelKey: 'report', icon: FileBarChart },
    ],
  },
  {
    id: 'inventory', labelKey: 'sectionInventory', items: [
      { href: '/stock', labelKey: 'stock', icon: Warehouse },
      { href: '/stock-forecast', labelKey: 'stockForecast', icon: TrendingDown },
      // Catalog Links hidden from nav (route still reachable at /catalog-links)
      { href: '/gap', labelKey: 'gapAnalysis', icon: SearchX },
      { href: '/scrap', labelKey: 'scrap', icon: Trash2 },
      { href: '/returns', labelKey: 'returns', icon: RotateCcw },
    ],
  },
  {
    id: 'sales', labelKey: 'sectionSales', items: [
      { href: '/customers', labelKey: 'customers', icon: Users },
      { href: '/receivables', labelKey: 'receivables', icon: Receipt },
      { href: '/margin', labelKey: 'margin', icon: Percent },
      { href: '/pricing', labelKey: 'pricing', icon: DollarSign },
      { href: '/ebay', labelKey: 'ebay', icon: ShoppingCart },
      { href: '/ebay-reco', labelKey: 'ebayReco', icon: PackageCheck },
      { href: '/sales-rep', labelKey: 'salesRep', icon: Briefcase },
    ],
  },
  {
    id: 'operations', labelKey: 'sectionOperations', items: [
      { href: '/suppliers', labelKey: 'suppliers', icon: PackageCheck },
      { href: '/shipments', labelKey: 'inboundShipments', icon: Container },
      { href: '/deliveries', labelKey: 'deliveries', icon: Truck },
      { href: '/vehicle-intelligence', labelKey: 'vehicleIntelligence', icon: CarFront },
      { href: '/alerts', labelKey: 'alerts', icon: Bell },
    ],
  },
  {
    // Chat admin (integrated from chat.jan.parts)
    id: 'chat', labelKey: 'sectionChat', items: [
      { href: '/chat/flow-decisions', labelKey: 'chatFlowDecisions', icon: GitBranch },
      { href: '/chat/word-mappings', labelKey: 'chatWordMappings', icon: Languages },
      { href: '/chat/monitoring', labelKey: 'chatMonitoring', icon: Activity },
      { href: '/chat/analytics', labelKey: 'chatAnalytics', icon: MessagesSquare },
      { href: '/chat/parts-analytics', labelKey: 'chatPartsAnalytics', icon: Bot },
    ],
  },
]

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname()
  const { t, dir } = useLocale()
  const isRTL = dir === 'rtl'
  const { data: unackCount } = useUnacknowledgedCount()

  const renderItem = (item: NavItem) => {
    const isActive = pathname === item.href
    const Icon = item.icon
    const showBadge =
      (item.href === '/customers/health-score' || item.href === '/customers') &&
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
    <TooltipProvider delayDuration={0}>
      <aside
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
          {navSections.map((section, si) => (
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
