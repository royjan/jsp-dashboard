'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { pageTransition } from '@/lib/motion'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { MobileNav } from '@/components/layout/MobileNav'
import { QueryLoadingBar } from '@/components/layout/QueryLoadingBar'
import { cn } from '@/lib/utils'

// Pages that render their own full-screen layout (no sidebar/topbar/mobile-nav)
const FULLSCREEN_PATHS = ['/deliveries/driver', '/login']

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()

  const isFullscreen = FULLSCREEN_PATHS.some((p) => pathname.startsWith(p))

  if (isFullscreen) {
    return (
      <>
        <QueryLoadingBar />
        {children}
      </>
    )
  }

  // Logical margin-inline-start pushes content off the sidebar on the correct side in both LTR & RTL.
  const marginClass = collapsed ? 'lg:ms-16' : 'lg:ms-56'

  return (
    <>
      <QueryLoadingBar />
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      <div className={cn('min-h-screen transition-all duration-300', marginClass)}>
        <TopBar />
        <main className="p-2 sm:p-4 lg:p-6 pb-20 lg:pb-6">
          {/* Enter-only fade keyed on the route — no mode="wait" exit delay, so navigation
              shows the new page immediately instead of waiting for the old one to animate out. */}
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={pageTransition}
          >
            {children}
          </motion.div>
        </main>
      </div>
      <MobileNav />
    </>
  )
}
