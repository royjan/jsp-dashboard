'use client'

import { usePathname } from 'next/navigation'
import { Moon, Sun, Languages } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useLocale } from '@/lib/locale-context'
import { Button } from '@/components/ui/button'
import type { TranslationKey } from '@/lib/i18n'

const pageTitleKeys: Record<string, TranslationKey> = {
  '/': 'page.overview',
  '/demand': 'page.demand',
  '/sales': 'page.sales',
  '/seasonal': 'page.seasonal',
  '/reorder': 'page.reorder',
  '/stock': 'page.stock',
  '/insights': 'page.insights',
}

export function TopBar() {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const { locale, setLocale, t } = useLocale()

  const titleKey = pageTitleKeys[pathname]

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 md:px-6">
      <h1 className="text-lg font-semibold">{titleKey ? t(titleKey) : t('dashboard')}</h1>
      <div className="flex items-center gap-1">
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
