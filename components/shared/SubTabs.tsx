'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface SubTab {
  href: string
  label: string
}

/**
 * RTL-aware horizontal in-page tab bar. Links between sibling routes and
 * highlights the active one via the current pathname. Used to group pages
 * that share a sidebar entry (e.g. search + stock-check, customers + health).
 */
export function SubTabs({ tabs }: { tabs: SubTab[] }) {
  const pathname = usePathname()

  return (
    <div className="flex items-center gap-1 border-b">
      {tabs.map((tab) => {
        const isActive = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              'relative px-3 py-2 text-sm font-medium transition-colors -mb-px border-b-2',
              isActive
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
