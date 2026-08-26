'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Moon, Sun, Languages, RefreshCw, LogOut, MoreVertical } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useLocale } from '@/lib/locale-context'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { MoneyToggle } from '@/components/layout/MoneyToggle'
import { DensityToggle } from '@/components/layout/DensityToggle'
import { resolveRouteTitle, APP_TITLE_SUFFIX } from '@/lib/route-titles'


export function TopBar() {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const { locale, setLocale, t } = useLocale()
  const queryClient = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  const [syncStatus, setSyncStatus] = useState('')

  const handleSync = async () => {
    setSyncing(true)
    try {
      // 1. Rebuild FINAPI stock cache and wait until ready
      setSyncStatus('Rebuilding cache...')
      await fetch('/api/sync?mode=refresh-poll', { method: 'GET' })
      // 2. Run incremental sync (fetches recent invoices into DB)
      setSyncStatus('Syncing invoices...')
      await fetch('/api/sync?mode=incremental', { method: 'GET' })
      // 3. Invalidate relevant React Query caches so UI refreshes
      setSyncStatus('Refreshing...')
      const keys = ['items', 'stock', 'demand', 'reorder', 'seasonal', 'sales']
      for (const key of keys) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
    } catch (e) {
      console.error('Sync failed:', e)
    } finally {
      setSyncing(false)
      setSyncStatus('')
    }
  }

  // One map for all 76 routes, with dynamic and prefix fallbacks, instead of
  // 23 exact entries and "דשבורד" for the other 53.
  const route = resolveRouteTitle(pathname)
  const title = route ? (route.key ? t(route.key) : route.he) : t('dashboard')

  // The tab title was the static one from layout metadata on every screen, so
  // browser history and a row of open tabs were indistinguishable.
  //
  // This is an observer rather than a plain assignment because Next commits its
  // own metadata <title> AFTER this effect on the hydration pass and clobbers a
  // direct write. Deferring by one frame fixed the fast pages and still lost on
  // the ones that fetch data first — the clobber lands whenever THEIR metadata
  // commits, so there is no delay that is correct for every route. Watching the
  // element instead is timing-independent.
  //
  // It cannot loop: `apply` no-ops when the title already matches, so our own
  // write does not re-trigger it. The head observer catches Next REPLACING the
  // <title> node rather than editing its text.
  useEffect(() => {
    const next = `${route?.he ?? 'דשבורד'} · ${APP_TITLE_SUFFIX}`
    const apply = () => {
      if (document.title !== next) document.title = next
    }
    apply()

    const observers: MutationObserver[] = []
    const titleEl = document.head.querySelector('title')
    if (titleEl) {
      const o = new MutationObserver(apply)
      o.observe(titleEl, { childList: true, characterData: true, subtree: true })
      observers.push(o)
    }
    const headObserver = new MutationObserver(apply)
    headObserver.observe(document.head, { childList: true })
    observers.push(headObserver)

    return () => observers.forEach(o => o.disconnect())
  }, [route])

  // Five inline actions left ~110px for the title on a 390px screen, so every
  // page read as "ניתוח מ…". On mobile the secondary ones move into this menu;
  // from sm up the bar is unchanged.
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // `labelled` renders the same action as a menu row (icon + visible text) rather
  // than the bare icon the top bar uses, so the mobile overflow menu is readable.
  const actions = (labelled: boolean) => (
    <>
      <MoneyToggle labelled={labelled} />

      <DensityToggle labelled={labelled} />

      <Button
        variant="ghost"
        size={labelled ? 'sm' : 'sm'}
        onClick={handleSync}
        disabled={syncing}
        className="gap-1.5 text-xs"
        title={t('refresh')}
      >
        <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
        {labelled ? <span>{syncStatus || t('refresh')}</span>
                  : syncing && syncStatus && <span className="hidden sm:inline text-muted-foreground">{syncStatus}</span>}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => setLocale(locale === 'he' ? 'en' : 'he')}
        className="gap-1.5 text-xs"
      >
        <Languages className="h-4 w-4" />
        {locale === 'he' ? 'EN' : 'HE'}
      </Button>

      <Button
        variant="ghost"
        size={labelled ? 'sm' : 'icon'}
        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        className={labelled ? 'gap-1.5 text-xs' : undefined}
      >
        <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        <span className={labelled ? 'ms-5' : 'sr-only'}>{t('toggleTheme')}</span>
      </Button>

      <Button
        variant="ghost"
        size={labelled ? 'sm' : 'icon'}
        onClick={() => { window.location.href = '/api/auth/logout' }}
        title={t('logout')}
        className={labelled ? 'gap-1.5 text-xs' : undefined}
      >
        <LogOut className="h-4 w-4" />
        <span className={labelled ? undefined : 'sr-only'}>{t('logout')}</span>
      </Button>
    </>
  )

  return (
    <header data-print="hide" className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 md:px-6">
      {/* Not an <h1>: the top bar is chrome, and the page's own PageHeader owns
          the document's single h1. Two of them on the same screen is both an a11y
          fault and a rendering of the same string twice.
          min-w-0 is what lets the flex child actually shrink so truncate works. */}
      <div className="text-sm sm:text-lg font-semibold truncate min-w-0 flex-1">
        {title}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <CommandPalette />

        {/* sm+ : everything inline, exactly as before */}
        <div className="hidden sm:flex items-center gap-1">{actions(false)}</div>

        {/* mobile : one overflow button */}
        <div className="relative sm:hidden" ref={menuRef}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMenuOpen(o => !o)}
            aria-label="More actions"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
          {menuOpen && (
            <div
              role="menu"
              onClick={() => setMenuOpen(false)}
              className="absolute top-full mt-1 end-0 z-50 min-w-[11rem] rounded-lg border bg-popover p-1 shadow-lg flex flex-col items-stretch [&>*]:w-full [&>*]:justify-start"
            >
              {actions(true)}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
