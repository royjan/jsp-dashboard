'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRecentDestinations, recordDestination, clearRecentDestinations } from '@/lib/recent-destinations'
import { OPEN_COMMAND_PALETTE } from '@/lib/command-palette'
import { Command } from 'cmdk'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useQueryClient } from '@tanstack/react-query'
import { useLocale } from '@/lib/locale-context'
import { flatSectionsFor } from '@/lib/navigation'
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
    stock_qty?: number | null
    price?: number | null
    /** The manufacturer's current number, when the catalog is ahead of our chain. */
    catalog_current_code?: string | null
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
  // The two endpoints are held apart rather than merged on arrival, so the one
  // that answers first can paint without waiting for the other. They are not
  // equally fast: the exact search goes to the ERP and takes ~0.7s, the smart
  // one is served from Redis in ~0.25s, and merging them into a single state
  // meant every result waited for the slower of the two.
  const [exactResults, setExactResults] = useState<SearchResult | null>(null)
  const [smartItems, setSmartItems] = useState<NonNullable<SearchResult['semantic']> | null>(null)
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Bumped per search; a response from an earlier one is dropped, not painted. */
  const searchSeq = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
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

  // The same palette, opened by things that are not a keyboard: the sidebar
  // entry, the phone's bottom tab, the "part not found" card. They replaced the
  // /search page, so this is now the only smart search there is.
  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener(OPEN_COMMAND_PALETTE, onOpen)
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE, onOpen)
  }, [])

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!query || query.length < 2) {
      searchSeq.current++
      setExactResults(null)
      setSmartItems(null)
      setSearching(false)
      return
    }

    setSearching(true)
    debounceRef.current = setTimeout(() => {
      const q = encodeURIComponent(query)
      const seq = ++searchSeq.current
      const current = () => seq === searchSeq.current
      let outstanding = 2
      const settle = () => {
        outstanding -= 1
        if (current() && outstanding === 0) setSearching(false)
      }

      // Two endpoints, because /api/search only reaches for the embeddings when
      // the query LOOKS like a sentence, and caps them at five. That heuristic
      // is why this palette and the /search page returned different things for
      // the same words: the page always asked, so it found the part you could
      // only describe ("משאבת הזרקה") while ⌘K came back empty and sent you to
      // the sidebar. Ask outright, and there is one search again.
      //
      // Each lands on its own. Typing a code used to show nothing for as long as
      // the slowest half took; now the codes appear as soon as the ERP answers
      // and the smart group fills in underneath them.
      fetch(`/api/search?q=${q}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((data) => {
          if (current() && data) setExactResults(data)
        })
        .finally(settle)

      fetch(`/api/search/semantic?q=${q}&limit=8`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((data) => {
          if (current() && data) setSmartItems(data.items ?? [])
        })
        .finally(settle)
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  // Semantic recall is fuzzy by construction, so anything the exact search
  // already matched is a duplicate row for the same part, not a second hit.
  // Deduped here rather than on arrival because the two halves no longer arrive
  // together -- the codes to dedup against may land after the rows to dedup.
  const smartRows = useMemo(() => {
    const exactCodes = new Set(
      [...(exactResults?.items ?? []), ...(exactResults?.catalog ?? [])].map(
        (i: { code: string }) => i.code?.toUpperCase(),
      ),
    )
    // `exactResults.semantic` is the fallback the exact endpoint folds in itself
    // when it decided the query looked like a sentence.
    const raw = (smartItems?.length ? smartItems : exactResults?.semantic) ?? []
    // A row whose CODE contains what you typed is not a smart find, whatever
    // endpoint returned it. Typing 1920L matched thirteen codes, the exact
    // search returned the first few, and the rest came back through the other
    // endpoint and landed under "smart search" -- so 1920LL was an item and
    // 1920LR was an insight, for no reason a reader could see. That is a cap
    // artefact, not a discovery. When embeddings arrive this filter stops
    // matching anything, because a semantic hit is found by its name.
    const needle = query.trim().toUpperCase()
    return raw.filter((i: { code: string }) => {
      const code = i.code?.toUpperCase()
      return !exactCodes.has(code) && !(needle && code?.includes(needle))
    })
  }, [exactResults, smartItems, query])

  const runAction = useCallback(
    (action: () => void) => {
      setOpen(false)
      setQuery('')
      setExactResults(null)
      setSmartItems(null)
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

  // ⌘K should leave you typing, not hunting for the box.
  //
  // `autoFocus` alone does not do it reliably: the palette mounts in the same
  // commit as the keydown that opened it, and whatever had focus -- the trigger
  // button, a nav link, the page behind -- can still hold it when the browser
  // gets around to the autofocus. Re-asserting it on the next frame, after the
  // dialog is painted, is the difference between typing "1920LL" into the
  // palette and typing it into nothing.
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  // Reset state when closing
  useEffect(() => {
    if (!open) {
      setQuery('')
      setExactResults(null)
      setSmartItems(null)
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

      {/* Command Palette Dialog.

          Closing by clicking away is handled on the overlay, not the backdrop.
          The backdrop is a SIBLING of the palette rather than its parent, so it
          only caught clicks that happened to miss the box's own rectangle. And
          on mousedown, not click, so a press that starts outside closes on the
          press instead of waiting for a mouseup the pointer may never deliver
          there. The palette stops the event, which is what keeps clicking
          inside it from closing it. */}
      {open && (
        <div className="fixed inset-0 z-50" onMouseDown={closePalette}>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />

          {/* Palette */}
          {/* Sits higher on a phone: the on-screen keyboard eats the lower half,
              and at top-[15%] the first results were pushed under it. */}
          <div
            className="fixed inset-x-0 top-[5%] sm:top-[15%] mx-auto max-w-lg px-4"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Command
              className="rounded-xl border bg-popover text-popover-foreground shadow-2xl overflow-hidden"
              dir="rtl"
              shouldFilter={!query || query.length < 2}
            >
              <div className="flex items-center border-b px-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground me-2" />
                <Command.Input
                  ref={inputRef}
                  autoFocus
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
                {exactResults?.items && exactResults.items.length > 0 && (
                  <Command.Group
                    heading={t('cmd.items')}
                    className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {exactResults.items.map((item) => (
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
                            // Land on the number the manufacturer sells the
                            // part as today. Searching 1609697180 used to open
                            // 1609697180 even though the catalog superseded it
                            // by 1685352580 -- our own chain simply stops where
                            // the price list we buy against stops. That page now
                            // carries the stock and price through the chain, so
                            // this costs nothing and answers the newer question.
                            const target = item.catalog_current_code || item.code
                            recordDestination({
                              href: `/items/${encodeURIComponent(target)}`,
                              label: target,
                              sublabel: item.name || item.description,
                              kind: 'item',
                            })
                            router.push(`/items/${encodeURIComponent(target)}`)
                          })
                        }
                        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground"
                      >
                        <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate flex items-center gap-1.5">
                            <span className="truncate">{item.code}</span>
                            {item.catalog_current_code && (
                              <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
                                → {item.catalog_current_code}
                              </span>
                            )}
                          </div>
                          {(item.name || item.description) && (
                            <div className="text-xs text-muted-foreground truncate">
                              {item.name || item.description}
                            </div>
                          )}
                        </div>
                        {/* `!= null`, not `!== undefined`: the API returns null
                            for a code whose stock lives on its canonical twin, and
                            null passed that test -- the row rendered "Stock:" with
                            nothing after it. Same figures, same order as the smart
                            rows below, because they are rows in one list. */}
                        <span className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
                          {item.price != null && item.price > 0 && (
                            <span className="tabular-nums">{formatCurrency(item.price)}</span>
                          )}
                          {item.stock_qty != null && (
                            <span className="tabular-nums">
                              {t('cmd.stockQty')}: {item.stock_qty}
                            </span>
                          )}
                        </span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}

                {/* Search Results: Partly catalog (Toyota/MG codes not in the ERP) */}
                {exactResults?.catalog && exactResults.catalog.length > 0 && (
                  <Command.Group
                    heading={t('cmd.catalog')}
                    className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {exactResults.catalog.map((item) => (
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
                {exactResults?.customers && exactResults.customers.length > 0 && (
                  <Command.Group
                    heading={t('cmd.customers')}
                    className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {exactResults.customers.map((cust) => {
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
                {smartRows.length > 0 && (
                  <Command.Group
                    heading={t('cmd.smartSearch')}
                    className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {smartRows.map((item) => (
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
                    heading={t('recentlyOpened')}
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
                {flatSectionsFor('palette').map((section) => (
                  <Command.Group
                    key={section.id}
                    heading={t(section.labelKey)}
                    className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
                  >
                    {section.items.map((item) => {
                      const Icon = item.icon
                      // A tab promoted out of its parent says which screen it
                      // belongs to: 'זיכויים' alone is indistinguishable from
                      // 'זיכויי ספקים' in a flat list. The parent name is in
                      // `value` too, so typing the screen finds its tabs.
                      const parent = item.qualifierKey ? t(item.qualifierKey) : null
                      return (
                        <Command.Item
                          key={item.href}
                          value={`nav ${parent ? `${parent} ` : ''}${t(item.labelKey)} ${item.href}`}
                          onSelect={() => runAction(() => {
                            // `kind: 'page'` had NO writer anywhere — the store defined it,
                            // nothing recorded it. So the surfaces that want "screens you
                            // opened recently" (the phone sheet) had an always-empty list.
                            recordDestination({
                              href: item.href,
                              label: t(item.labelKey),
                              sublabel: parent ?? undefined,
                              kind: 'page',
                            })
                            router.push(item.href)
                          })}
                          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm cursor-pointer aria-selected:bg-accent aria-selected:text-accent-foreground"
                        >
                          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span>
                            {parent && <span className="text-muted-foreground">{parent} › </span>}
                            {t(item.labelKey)}
                          </span>
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
