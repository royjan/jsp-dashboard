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
  GitMerge,
  GitBranch,
  Languages,
  Activity,
  MessagesSquare,
  Bot,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useUnacknowledgedCount } from '@/hooks/use-analytics'

const navItems: Array<{ href: string; labelKey: TranslationKey; icon: typeof LayoutDashboard }> = [
  { href: '/', labelKey: 'overview', icon: LayoutDashboard },
  { href: '/search', labelKey: 'smartSearch', icon: Sparkles },
  { href: '/seasonal', labelKey: 'seasonal', icon: Sun },
  { href: '/stock', labelKey: 'stock', icon: Warehouse },
  { href: '/stock-forecast', labelKey: 'stockForecast', icon: TrendingDown },
  { href: '/customers', labelKey: 'customers', icon: Users },
  { href: '/receivables', labelKey: 'receivables', icon: Receipt },
  { href: '/catalog-links', labelKey: 'catalogLinks', icon: GitMerge },
  { href: '/gap', labelKey: 'gapAnalysis', icon: SearchX },
  { href: '/scrap', labelKey: 'scrap', icon: Trash2 },
  { href: '/returns', labelKey: 'returns', icon: RotateCcw },
  { href: '/ebay', labelKey: 'ebay', icon: ShoppingCart },
  { href: '/margin', labelKey: 'margin', icon: Percent },
  { href: '/vehicle-intelligence', labelKey: 'vehicleIntelligence', icon: CarFront },
  { href: '/alerts', labelKey: 'alerts', icon: Bell },
  { href: '/pricing', labelKey: 'pricing', icon: DollarSign },
  { href: '/suppliers', labelKey: 'suppliers', icon: PackageCheck },
  { href: '/deliveries', labelKey: 'deliveries', icon: Truck },
  { href: '/shipments', labelKey: 'inboundShipments', icon: Container },
  { href: '/sales-rep', labelKey: 'salesRep', icon: Briefcase },
  { href: '/report', labelKey: 'report', icon: FileBarChart },
  // Chat admin (integrated from chat.jan.parts)
  { href: '/chat/flow-decisions', labelKey: 'chatFlowDecisions', icon: GitBranch },
  { href: '/chat/word-mappings', labelKey: 'chatWordMappings', icon: Languages },
  { href: '/chat/monitoring', labelKey: 'chatMonitoring', icon: Activity },
  { href: '/chat/analytics', labelKey: 'chatAnalytics', icon: MessagesSquare },
  { href: '/chat/parts-analytics', labelKey: 'chatPartsAnalytics', icon: Bot },
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

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'fixed top-0 z-40 h-screen border-e bg-card transition-all duration-300 hidden lg:flex flex-col',
          isRTL ? 'right-0' : 'left-0',
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

        <nav className="flex-1 overflow-y-auto space-y-1 p-2">
          {navItems.map((item) => {
            const isActive = pathname === item.href
            const Icon = item.icon
            // Show badge on health-score and customers nav items
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
                    <span className="absolute -top-1 -end-1 h-2 w-2 rounded-full bg-red-500" />
                  )}
                </span>
                {!collapsed && (
                  <span className="flex items-center gap-2">
                    {t(item.labelKey)}
                    {showBadge && (
                      <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
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
          })}
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
