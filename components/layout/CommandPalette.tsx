'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRecentDestinations, recordDestination, clearRecentDestinations } from '@/lib/recent-destinations'
import { Command } from 'cmdk'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useQueryClient } from '@tanstack/react-query'
import { useLocale } from '@/lib/locale-context'
import { sectionsFor } from '@/lib/navigation'
import { brandChipClasses } from '@/lib/brand'
import { Eye, EyeOff, Loader2, Moon, Package, RefreshCw, Search, Sparkles, Sun, User, Clock, X } from 'lucide-react'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { formatCurrency } from '@/lib/format'
import { toggleMoneyHidden } from '@/lib/privacy'


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
    price?: number | null
    stock_qty?: number | null
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
  const recents = useRecentDestinations()

  // Every exit path goes through here so the box is empty for the next ⌘K
  // rather than reopening on a stale query. Doing it in an effect keyed on
  // `open` would be a setState during render-commit for the same result.
  const closePalette = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

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
          setQuery('')
          return false
        })
      }
    }
    // Capture phase: cmdk installs its own Escape handling on the input, and on
    // the bubble phase it can consume the event before this sees it.
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

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
      const q = encodeURIComponent(query)
      // Two endpoints, because /api/search only reaches for the embeddings when
      // the query LOOKS like a sentence, and caps them at five. That heuristic
      // is why this palette and the /search page returned different things for
      // the same words: the page always asked, so it found the part you could
      // only describe ("משאבת הזרקה") while ⌘K came back empty and sent you to
      // the sidebar. Ask outright, and there is one search again.
      const [exact, semantic] = await Promise.allSettled([
        fetch(`/api/search?q=${q}`).then(r => (r.ok ? r.json() : null)),
        fetch(`/api/search/semantic?q=${q}&limit=8`).then(r => (r.ok ? r.json() : null)),
      ])

      const base = exact.status === 'fulfilled' && exact.value ? exact.value : null
      const smart =
        semantic.status === 'fulfilled' && semantic.value?.items?.length
          ? semantic.value.items
          : base?.semantic

      // Semantic recall is fuzzy by construction, so anything the exact search
      // already matched is a duplicate row for the same part, not a second hit.
      const exactCodes = new Set(
        [...(base?.items ?? []), ...(base?.catalog ?? [])].map((i: { code: string }) =>
          i.code?.toUpperCase(),
        ),
      )

      if (base || smart) {
        setSearchResults({
          items: base?.items ?? [],
          customers: base?.customers ?? [],
          catalog: base?.catalog ?? [],
          semantic: (smart ?? []).filter(
            (i: { code: string }) => !exactCodes.has(i.code?.toUpperCase()),
          ),
        })
      }
      setSearching(false)
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
            onClick={closePalette}
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
                            // The item card, like every other result here. This
                            // row used to go to /stock?q=CODE -- a filtered
                            // stock list, except the stock page reads `search`
                            // and has never read `q`, so it opened the whole
                            // catalogue unfiltered and the part you searched for
                            // was somewhere in it. Catalogue and semantic hits
                            // already opened /items/CODE; searching by code was
                            // the one path that did not.
                            recordDestination({
                              href: `/items/${encodeURIComponent(item.code)}`,
                              label: item.code,
                              sublabel: item.name || item.description,
                              kind: 'item',
                            })
                            router.push(`/items/${encodeURIComponent(item.code)}`)
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
                        <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
                          {item.price != null && item.price > 0 && (
                            <span className="tabular-nums">{formatCurrency(item.price)}</span>
                          )}
                          {item.stock_qty != null && (
                            <span
                              className={
                                'tabular-nums ' +
                                (item.stock_qty > 5
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : item.stock_qty > 0
                                    ? 'text-amber-600 dark:text-amber-400'
                                    : 'text-red-600 dark:text-red-400')
                              }
                            >
                              {t('cmd.stockQty')}: {item.stock_qty}
                            </span>
                          )}
                          <span className="tabular-nums">{Math.round(item.similarity * 100)}%</span>
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {/* Recently opened — only with an empty box, where it is a
                    shortcut. Once you are typing, search results are the answer
                    and a recents list competing with them is noise. */}
                {!query && recents.length > 0 && (
                  <Command.Group
                    heading="נפתחו לאחרונה"
                    className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {recents.map((r) => (
                      <Command.Item
                        key={`recent-${r.href}`}
                        value={`recent ${r.label} ${r.sublabel ?? ''}`}
                        onSelect={() => runAction(() => router.push(r.href))}
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground"
                      >
                        <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{r.label}</div>
                          {r.sublabel && (
                            <div className="text-xs text-muted-foreground truncate">{r.sublabel}</div>
                          )}
                        </div>
                      </Command.Item>
                    ))}
                    <Command.Item
                      value="recent clear נקה"
                      onSelect={() => clearRecentDestinations()}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs text-muted-foreground cursor-pointer aria-selected:bg-accent"
                    >
                      <X className="h-3.5 w-3.5 shrink-0" />
                      נקה היסטוריה
                    </Command.Item>
                  </Command.Group>
                )}

                {/* Navigation -- every destination, grouped as the sidebar groups
                    them. This used to be a hand-kept list of 24 that had drifted
                    19 entries behind the sidebar, so whole areas of the app
                    (suppliers, shipments, deliveries, all of chat) simply could
                    not be reached from the keyboard. */}
                {sectionsFor('palette').map((section) => (
                  <Command.Group
                    key={section.id}
                    heading={t(section.labelKey)}
                    className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {section.items.map((item) => {
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
                ))}

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
