'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'
import { LayoutDashboard, Sun, Warehouse, Users, Trash2, FileBarChart } from 'lucide-react'
import type { TranslationKey } from '@/lib/i18n'

const mobileNav: Array<{ href: string; labelKey: TranslationKey; icon: typeof LayoutDashboard }> = [
  { href: '/', labelKey: 'home', icon: LayoutDashboard },
  { href: '/seasonal', labelKey: 'seasonal', icon: Sun },
  { href: '/stock', labelKey: 'stock', icon: Warehouse },
  { href: '/customers', labelKey: 'customers', icon: Users },
  { href: '/scrap', labelKey: 'scrap', icon: Trash2 },
  { href: '/report', labelKey: 'report', icon: FileBarChart },
]

export function MobileNav() {
  const pathname = usePathname()
  const { t } = useLocale()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background lg:hidden">
      <div className="flex items-center justify-around h-14">
        {mobileNav.map((item) => {
          const isActive = pathname === item.href
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 text-xs transition-colors min-h-[44px] min-w-[44px]',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{t(item.labelKey)}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
