'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRecentDestinations, recordDestination, clearRecentDestinations } from '@/lib/recent-destinations'
import { Command } from 'cmdk'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useQueryClient } from '@tanstack/react-query'
import { useLocale } from '@/lib/locale-context'
import type { TranslationKey } from '@/lib/i18n'
import { brandChipClasses } from '@/lib/brand'
import {
  Bell,
  BookOpen,
  DollarSign,
  Eye,
  EyeOff,
  FileBarChart,
  Landmark,
  LayoutDashboard,
  Loader2,
  Moon,
  NotebookPen,
  Package,
  Percent,
  Receipt,
  RefreshCw,
  RotateCcw,
  Scale,
  Search,
  SearchX,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Sun,
  Swords,
  Trash2,
  TrendingDown,
  User,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { toggleMoneyHidden } from '@/lib/privacy'

const navItems: Array<{ href: string; labelKey: TranslationKey; icon: typeof LayoutDashboard }> = [
  { href: '/', labelKey: 'overview', icon: LayoutDashboard },
  { href: '/bookkeeping', labelKey: 'bookkeepingOverview', icon: BookOpen },
  { href: '/bookkeeping/accounts', labelKey: 'bookkeepingAccounts', icon: Landmark },
  { href: '/bookkeeping/trial-balance', labelKey: 'bookkeepingTrialBalance', icon: Scale },
  { href: '/bookkeeping/journal', labelKey: 'bookkeepingJournal', icon: NotebookPen },
  { href: '/bookkeeping/vat', labelKey: 'bookkeepingVat', icon: Percent },
  { href: '/bookkeeping/cash', labelKey: 'bookkeepingCash', icon: Wallet },
  { href: '/bookkeeping/purchasing', labelKey: 'bookkeepingPurchasing', icon: ShoppingBag },
  { href: '/search', labelKey: 'smartSearch', icon: Sparkles },
  { href: '/seasonal', labelKey: 'seasonal', icon: Sun },
  { href: '/stock', labelKey: 'stock', icon: Warehouse },
  { href: '/stock-forecast', labelKey: 'stockForecast', icon: TrendingDown },
  { href: '/customers', labelKey: 'customers', icon: Users },
  { href: '/receivables', labelKey: 'receivables', icon: Receipt },
  { href: '/gap', labelKey: 'gapAnalysis', icon: SearchX },
  { href: '/scrap', labelKey: 'scrap', icon: Trash2 },
  { href: '/returns', labelKey: 'returns', icon: RotateCcw },
  { href: '/ebay', labelKey: 'ebay', icon: ShoppingCart },
  { href: '/ebay-reco', labelKey: 'ebayReco', icon: ShoppingCart },
  { href: '/margin', labelKey: 'margin', icon: Percent },
  { href: '/competitors', labelKey: 'competitors', icon: Swords },
  { href: '/alerts', labelKey: 'alerts', icon: Bell },
  { href: '/pricing', labelKey: 'pricing', icon: DollarSign },
  { href: '/report', labelKey: 'report', icon: FileBarChart },
]

interface SearchResult {
  items: Array<{
    code: string
    name?: string
    description?: string
    stock_qty?: number
  }>
  customers: Array<{
    code?: string
    customer_code?: string
    name?: string
    customer_name?: string
  }>
  semantic?: Array<{
    code: string
    name: string
    similarity: number
  }>
  /** Partly-catalog codes the ERP doesn't know — Toyota (SU0*) part ids etc. */
  catalog?: Array<{
    code: string
    brand: string
    description?: string | null
    hebrewDescription?: string | null
  }>
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const moneyHidden = useMoneyHidden()
  const queryClient = useQueryClient()
  const { t } = useLocale()

  // Keyboard: Cmd/Ctrl+K toggles, Escape closes.
  //
  // Escape was missing entirely — the only ways out were clicking the backdrop
  // or picking something, which on a keyboard-driven surface means the shortcut
  // that opens it had no counterpart to abandon it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
        return
      }
      if (e.key === 'Escape') {
        // Only swallow the key when this is actually open, so Escape keeps
        // working for whatever else is on screen.
        setOpen(prev => {
          if (!prev) return prev
          e.preventDefault()
          e.stopPropagation()
          return false
        })
      }
    }
    // Capture phase: cmdk installs its own Escape handling on the input, and on
    // the bubble phase it can consume the event before this sees it.
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Leave the box empty for the next ⌘K rather than reopening on a stale query.
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!query || query.length < 2) {
      setSearchResults(null)
      setSearching(false)
      return
    }

    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        if (res.ok) {
          const data = await res.json()
          setSearchResults(data)
        }
      } catch {
        // silently fail
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  const runAction = useCallback(
    (action: () => void) => {
      setOpen(false)
      setQuery('')
      setSearchResults(null)
      action()
    },
    []
  )

  const handleRefresh = useCallback(() => {
    const keys = ['items', 'stock', 'demand', 'reorder', 'seasonal', 'sales', 'dashboard', 'customers']
    for (const key of keys) {
      queryClient.invalidateQueries({ queryKey: [key] })
    }
  }, [queryClient])

  // Reset state when closing
  useEffect(() => {
    if (!open) {
      setQuery('')
      setSearchResults(null)
      setSearching(false)
    }
  }, [open])

  return (
    <>
      {/* Trigger button for TopBar */}
      <button
        onClick={() => setOpen(true)}
        aria-label={t('search')}
        className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground border rounded-lg hover:bg-accent hover:text-foreground transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t('search')}</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
          <span className="text-xs">⌘</span>K
        </kbd>
      </button>

      {/* Command Palette Dialog */}
      {open && (
        <div className="fixed inset-0 z-50">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Palette */}
          {/* Sits higher on a phone: the on-screen keyboard eats the lower half,
              and at top-[15%] the first results were pushed under it. */}
          <div className="fixed inset-x-0 top-[5%] sm:top-[15%] mx-auto max-w-lg px-4">
            <Command
              className="rounded-xl border bg-popover text-popover-foreground shadow-2xl overflow-hidden"
              dir="rtl"
              shouldFilter={!query || query.length < 2}
            >
              <div className="flex items-center border-b px-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground me-2" />
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder={t('cmd.searchPlaceholder')}
                  className="flex h-12 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
                />
                {searching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
              </div>

              <Command.List className="max-h-[min(60dvh,400px)] overflow-y-auto overscroll-contain p-2">
                <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
                  {searching ? t('cmd.searching') : t('cmd.noResults')}
                </Command.Empty>

                {/* Search Results: Items */}
                {searchResults?.items && searchResults.items.length > 0 && (
                  <Command.Group
                    heading={t('cmd.items')}
                    className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {searchResults.items.map((item) => (
                      <Command.Item
                        key={`item-${item.code}`}
                        value={`item ${item.code} ${item.name || ''}`}
                        onSelect={() =>
                          runAction(() => {
                            recordDestination({
                              href: `/stock?q=${item.code}`,
                              label: item.code,
                              sublabel: item.name || item.description,
                              kind: 'item',
                            })
                            router.push(`/stock?q=${item.code}`)
                          })
                        }
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground"
                      >
                        <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{item.code}</div>
                          {(item.name || item.description) && (
                            <div className="text-xs text-muted-foreground truncate">
                              {item.name || item.description}
                            </div>
                          )}
                        </div>
                        {item.stock_qty !== undefined && (
                          <span className="text-xs text-muted-foreground whitespace-nowrap">
                            {t('cmd.stockQty')}: {item.stock_qty}
                          </span>
                        )}
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {/* Search Results: Partly catalog (Toyota/MG codes not in the ERP) */}
                {searchResults?.catalog && searchResults.catalog.length > 0 && (
                  <Command.Group
                    heading={t('cmd.catalog')}
                    className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {searchResults.catalog.map((item) => (
                      <Command.Item
                        key={`cat-${item.code}`}
                        value={`catalog ${item.code} ${item.description || ''}`}
                        onSelect={() =>
                          runAction(() => {
                            recordDestination({
                              href: `/items/${encodeURIComponent(item.code)}`,
                              label: item.code,
                              sublabel: item.hebrewDescription || item.description || undefined,
                              kind: 'item',
                            })
                            router.push(`/items/${encodeURIComponent(item.code)}`)
                          })
                        }
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground"
                      >
                        <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate font-mono" dir="ltr">{item.code}</div>
                          {(item.hebrewDescription || item.description) && (
                            <div className="text-xs text-muted-foreground truncate" dir="auto">
                              {item.hebrewDescription || item.description}
                            </div>
                          )}
                        </div>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${brandChipClasses(item.brand)}`}>
                          {item.brand}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {/* Search Results: Customers */}
                {searchResults?.customers && searchResults.customers.length > 0 && (
                  <Command.Group
                    heading={t('cmd.customers')}
                    className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {searchResults.customers.map((cust) => {
                      const code = cust.code || cust.customer_code || ''
                      const name = cust.name || cust.customer_name || ''
                      return (
                        <Command.Item
                          key={`cust-${code}`}
                          value={`customer ${code} ${name}`}
                          onSelect={() =>
                            runAction(() => {
                              recordDestination({
                                href: `/customers/${code}`,
                                label: cust.name || code,
                                sublabel: code,
                                kind: 'customer',
                              })
                              router.push(`/customers/${code}`)
                            })
                          }
                          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground"
                        >
                          <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{name || code}</div>
                            {name && code && (
                              <div className="text-xs text-muted-foreground">{code}</div>
                            )}
                          </div>
                        </Command.Item>
                      )
                    })}
                  </Command.Group>
                )}

                {/* Search Results: Semantic (Smart Search) */}
                {searchResults?.semantic && searchResults.semantic.length > 0 && (
                  <Command.Group
                    heading={t('cmd.smartSearch')}
                    className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {searchResults.semantic.map((item) => (
                      <Command.Item
                        key={`sem-${item.code}`}
                        value={`semantic ${item.code} ${item.name}`}
                        onSelect={() =>
                          runAction(() => {
                            recordDestination({
                              href: `/items/${encodeURIComponent(item.code)}`,
                              label: item.code,
                              sublabel: item.name,
                              kind: 'item',
                            })
                            router.push(`/items/${encodeURIComponent(item.code)}`)
                          })
                        }
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground"
                      >
                        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{item.code}</div>
                          <div className="text-xs text-muted-foreground truncate">{item.name}</div>
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {Math.round(item.similarity * 100)}%
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {/* Navigation */}
                <Command.Group
                  heading={t('cmd.navigation')}
                  className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                >
                  {navItems.map((item) => {
                    const Icon = item.icon
                    return (
                      <Command.Item
                        key={item.href}
                        value={`nav ${t(item.labelKey)} ${item.href}`}
                        onSelect={() => runAction(() => router.push(item.href))}
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span>{t(item.labelKey)}</span>
                      </Command.Item>
                    )
                  })}
                </Command.Group>

                {/* Actions */}
                <Command.Group
                  heading={t('cmd.actions')}
                  className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                >
                  <Command.Item
                    value="refresh data רענן נתונים"
                    onSelect={() => runAction(handleRefresh)}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground"
                  >
                    <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>{t('cmd.refreshData')}</span>
                  </Command.Item>
                  <Command.Item
                    value="toggle theme dark light מצב כהה בהיר"
                    onSelect={() => runAction(() => setTheme(theme === 'dark' ? 'light' : 'dark'))}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground"
                  >
                    {theme === 'dark' ? (
                      <Sun className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <Moon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span>{t('cmd.toggleTheme')}</span>
                  </Command.Item>
                  <Command.Item
                    value="hide show money amounts demo הסתר הצג סכומים כסף הדגמה"
                    onSelect={() => runAction(toggleMoneyHidden)}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground"
                  >
                    {moneyHidden ? (
                      <Eye className="h-4 w-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <EyeOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <span>{t('cmd.toggleMoney')}</span>
                  </Command.Item>
                </Command.Group>
              </Command.List>
            </Command>
          </div>
        </div>
      )}
    </>
  )
}
