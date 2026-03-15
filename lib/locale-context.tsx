'use client'

import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { translations, type Locale, type TranslationKey } from './i18n'

interface LocaleContextValue {
  locale: Locale
  dir: 'rtl' | 'ltr'
  setLocale: (locale: Locale) => void
  t: (key: TranslationKey) => string
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'he',
  dir: 'rtl',
  setLocale: () => {},
  t: (key) => key,
})

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('he')
  const dir = locale === 'he' ? 'rtl' : 'ltr'

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale)
    localStorage.setItem('jan-parts-locale', newLocale)
  }, [])

  const t = useCallback((key: TranslationKey) => {
    return translations[locale][key] || key
  }, [locale])

  // Load saved locale
  useEffect(() => {
    const saved = localStorage.getItem('jan-parts-locale') as Locale | null
    if (saved && (saved === 'he' || saved === 'en')) {
      setLocaleState(saved)
    }
  }, [])

  // Update html dir and lang attributes
  useEffect(() => {
    document.documentElement.dir = dir
    document.documentElement.lang = locale
  }, [locale, dir])

  return (
    <LocaleContext.Provider value={{ locale, dir, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useLocale() {
  return useContext(LocaleContext)
}
