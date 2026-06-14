'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Home, Users, DollarSign, ClipboardList } from 'lucide-react'

const tabs = [
  { href: '/sales-rep', label: 'בית', icon: Home, exact: true },
  { href: '/sales-rep/customers', label: 'לקוחות', icon: Users },
  { href: '/sales-rep/price-check', label: 'מחירים', icon: DollarSign },
  { href: '/sales-rep/visits', label: 'ביקורים', icon: ClipboardList },
]

export function SalesRepBottomNav() {
  const pathname = usePathname()

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 safe-area-bottom">
      <div className="flex items-center justify-around h-16">
        {tabs.map((tab) => {
          const isActive = tab.exact
            ? pathname === tab.href
            : pathname.startsWith(tab.href)
          const Icon = tab.icon
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex flex-col items-center justify-center gap-1 text-xs transition-colors min-h-[48px] min-w-[48px] px-2 rounded-lg',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              <Icon className="h-6 w-6" />
              <span className="font-medium">{tab.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
