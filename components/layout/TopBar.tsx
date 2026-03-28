'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Moon, Sun, Languages, RefreshCw } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useLocale } from '@/lib/locale-context'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import type { TranslationKey } from '@/lib/i18n'

const pageTitleKeys: Record<string, TranslationKey> = {
  '/': 'page.overview',
  '/demand': 'page.demand',
  '/sales': 'page.sales',
  '/seasonal': 'page.seasonal',
  '/reorder': 'page.reorder',
  '/stock': 'page.stock',
  '/conversion': 'page.conversion',
  '/abc': 'page.abc',
  '/customers': 'page.customers',
  '/scrap': 'page.scrap',
  '/report': 'page.report',
}

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

  const titleKey = pageTitleKeys[pathname]

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 md:px-6">
      <h1 className="text-lg font-semibold">{titleKey ? t(titleKey) : t('dashboard')}</h1>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSync}
          disabled={syncing}
          className="gap-1.5 text-xs"
          title={t('refresh')}
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing && syncStatus && <span className="hidden sm:inline text-muted-foreground">{syncStatus}</span>}
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
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">{t('toggleTheme')}</span>
        </Button>
      </div>
    </header>
  )
}
