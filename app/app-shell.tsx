'use client'

import { motion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { pageTransition } from '@/lib/motion'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { MobileNav } from '@/components/layout/MobileNav'
import { QueryLoadingBar } from '@/components/layout/QueryLoadingBar'
import { cn } from '@/lib/utils'
import { usePersisted } from '@/hooks/use-persisted'

// Pages that render their own full-screen layout (no sidebar/topbar/mobile-nav)
const FULLSCREEN_PATHS = ['/deliveries/driver', '/login']

export function AppShell({ children }: { children: React.ReactNode }) {
  // Persisted: this was plain useState, so the sidebar sprang back open on
  // every reload and every full navigation.
  const [collapsed, setCollapsed] = usePersisted('ui.sidebar.collapsed', false)
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
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      <div className={cn('min-h-screen transition-all duration-300', marginClass)}>
        <TopBar />
        {/* Bottom clearance = nav (3.5rem) + breathing room + the home-indicator
            inset. Deliberately NOT the `p-*` shorthand: Tailwind emits `sm:p-4`
            after the unprefixed `pb-*`, so the shorthand won above 640px and
            left only 16px of clearance under a 57px nav — the last row of every
            table sat behind it on tablets. Separate px/pt/pb can't collide. */}
        <main className="px-2 sm:px-4 lg:px-6 pt-2 sm:pt-4 lg:pt-6 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-6">
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
