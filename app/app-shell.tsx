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
  //
  // The default flipped with the rail. It used to be "expanded", because
  // collapsing meant losing the labels; the rail keeps them, so the default is
  // now the 80px rail and the flyout is opened by pointing at a section. Pinning
  // it is the opt-in, under its own key -- reusing 'ui.sidebar.collapsed' would
  // have read every existing user's stored `false` as "pin it open", which is
  // the opposite of what they last chose.
  const [pinned, setPinned] = usePersisted('ui.sidebar.pinned', false)
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

  // Logical margin-inline-start pushes content off the sidebar on the correct
  // side in both LTR & RTL. Rail only, or rail + pinned flyout (80 + 256).
  const marginClass = pinned ? 'lg:ms-[336px]' : 'lg:ms-20'

  return (
    <>
      <QueryLoadingBar />
      <Sidebar pinned={pinned} onTogglePin={() => setPinned(p => !p)} />
      <div className={cn('min-h-screen transition-all duration-300', marginClass)}>
        <TopBar />
        {/* Bottom clearance = dock (4rem) + the button overhanging it + the
            home-indicator inset. It was 5rem for a 3.5rem bar; the dock is
            taller now and the round button sits proud of it, so the last row of
            a table needs the extra half-rem or it lands underneath.

            Deliberately NOT the `p-*` shorthand: Tailwind emits `sm:p-4` after
            the unprefixed padding-bottom, so the shorthand won above 640px and
            left only 16px of clearance — separate px/pt/pb can't collide.

            And do not write a class-shaped string inside a comment anywhere
            in this repo. Tailwind scans comments too, so a utility quoted in
            prose is compiled as if it were real -- and one written with an
            ellipsis standing in for its argument emits invalid CSS, which
            fails the whole stylesheet and every page with it. */}
        <main className="px-2 sm:px-4 lg:px-6 pt-2 sm:pt-4 lg:pt-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-6">
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
