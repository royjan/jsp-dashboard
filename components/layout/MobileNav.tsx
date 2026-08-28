'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'
import { MOBILE_PRIMARY, MOBILE_MORE, isItemActive } from '@/lib/navigation'
import { openCommandPalette } from '@/lib/command-palette'
import { MoreHorizontal, X } from 'lucide-react'




export function MobileNav() {
  const pathname = usePathname()
  const { t } = useLocale()
  const [showMore, setShowMore] = useState(false)

  // Was `href === pathname`, so /bookkeeping/vat left the More tab unlit.
  const isMoreActive = MOBILE_MORE.some((item) => isItemActive(item, pathname, null))

  return (
    <div data-print="hide" className="contents">
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
              {MOBILE_MORE.map((item) => {
                const isActive = isItemActive(item, pathname, null)
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
    </div>
  )
}
