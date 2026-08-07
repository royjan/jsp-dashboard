'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'
import { LayoutDashboard, Sun, Warehouse, Users, Trash2, FileBarChart, Receipt, SearchX, TrendingDown, ShoppingCart, RotateCcw, CarFront, MoreHorizontal, X, Sparkles, Percent, Truck, Briefcase, PackageCheck, Swords } from 'lucide-react'
import type { TranslationKey } from '@/lib/i18n'

const primaryNav: Array<{ href: string; labelKey: TranslationKey; icon: typeof LayoutDashboard }> = [
  { href: '/', labelKey: 'overview', icon: LayoutDashboard },
  { href: '/search', labelKey: 'smartSearch', icon: Sparkles },
  { href: '/stock', labelKey: 'stock', icon: Warehouse },
  { href: '/customers', labelKey: 'customers', icon: Users },
]

const moreNav: Array<{ href: string; labelKey: TranslationKey; icon: typeof LayoutDashboard }> = [
  { href: '/sales-rep', labelKey: 'salesRep', icon: Briefcase },
  { href: '/deliveries/driver', labelKey: 'deliveries', icon: Truck },
  { href: '/stock-forecast', labelKey: 'stockForecast', icon: TrendingDown },
  { href: '/receivables', labelKey: 'receivables', icon: Receipt },
  { href: '/gap', labelKey: 'gapAnalysis', icon: SearchX },
  { href: '/scrap', labelKey: 'scrap', icon: Trash2 },
  { href: '/returns', labelKey: 'returns', icon: RotateCcw },
  { href: '/ebay', labelKey: 'ebay', icon: ShoppingCart },
  { href: '/ebay-reco', labelKey: 'ebayReco', icon: PackageCheck },
  { href: '/margin', labelKey: 'margin', icon: Percent },
  { href: '/suppliers', labelKey: 'suppliers', icon: PackageCheck },
  { href: '/competitors', labelKey: 'competitors', icon: Swords },
  { href: '/vehicle-intelligence', labelKey: 'vehicleIntelligence', icon: CarFront },
  { href: '/report', labelKey: 'report', icon: FileBarChart },
]

const allNav = [...primaryNav, ...moreNav]

export function MobileNav() {
  const pathname = usePathname()
  const { t } = useLocale()
  const [showMore, setShowMore] = useState(false)

  const isMoreActive = moreNav.some(item => item.href === pathname)

  return (
    <>
      {/* More menu overlay */}
      {showMore && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setShowMore(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute bottom-[calc(3.5rem+env(safe-area-inset-bottom))] inset-x-0 bg-background border-t rounded-t-2xl p-2 pb-1 max-h-[60vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 mb-1">
              <span className="text-sm font-medium text-muted-foreground">{t('more')}</span>
              <button
                onClick={() => setShowMore(false)}
                aria-label="Close menu"
                className="p-2 -me-1 rounded-md hover:bg-muted min-h-11 min-w-11 flex items-center justify-center"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {allNav.map((item) => {
                const isActive = pathname === item.href
                const Icon = item.icon
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setShowMore(false)}
                    className={cn(
                      'flex flex-col items-center justify-center gap-1 py-3 px-1 rounded-xl text-[11px] transition-colors min-h-[60px]',
                      isActive ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:bg-muted'
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-center leading-tight">{t(item.labelKey)}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden safe-area-bottom">
        <div className="flex items-center justify-around h-14">
          {primaryNav.map((item) => {
            const isActive = pathname === item.href
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 text-[11px] transition-colors min-h-[44px] px-1 flex-1 min-w-0',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="truncate max-w-full">{t(item.labelKey)}</span>
              </Link>
            )
          })}
          <button
            onClick={() => setShowMore(!showMore)}
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
    </>
  )
}
