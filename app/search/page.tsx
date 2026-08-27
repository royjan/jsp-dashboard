'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocale } from '@/lib/locale-context'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Search, Sparkles, Package, Clock, X, ArrowLeft, ChevronLeft } from 'lucide-react'
import { brandChipClasses } from '@/lib/brand'
import { formatCurrency } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { PageHeader } from '@/components/shared/PageHeader'

interface SemanticResult {
  code: string
  name: string
  similarity: number
  price: number | null
  stock_qty: number | null
  ordered_qty: number | null
  incoming_qty: number | null
}

interface ExactResult {
  code: string
  name?: string
  description?: string
  stock_qty?: number
  price?: number
}

/** Partly-catalog code the ERP doesn't know (Toyota SU0* ids etc.). */
interface CatalogResult {
  code: string
  brand: string
  description?: string | null
  hebrewDescription?: string | null
}

const RECENT_SEARCHES_KEY = 'jan-parts-recent-searches'
const MAX_RECENT = 8

function getRecentSearches(): string[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]')
  } catch {
    return []
  }
}

function addRecentSearch(query: string) {
  const recent = getRecentSearches().filter((s) => s !== query)
  recent.unshift(query)
  localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)))
}

function clearRecentSearches() {
  localStorage.removeItem(RECENT_SEARCHES_KEY)
}

function StockBadge({ qty, t }: { qty: number | null; t: (k: any) => string }) {
  if (qty === null || qty === undefined) return null
  if (qty > 5) {
    return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">{t('search.inStock')} ({qty})</Badge>
  }
  if (qty > 0) {
    return <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800">{t('search.lowStock')} ({qty})</Badge>
  }
  return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800">{t('search.outOfStock')}</Badge>
}

function RelevanceBar({ score }: { score: number }) {
  const pct = Math.round(score * 100)
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span>{pct}%</span>
    </div>
  )
}

function ResultSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-20" />
        </div>
        <Skeleton className="h-4 w-48" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
      </CardContent>
    </Card>
  )
}

export default function SearchPage() {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { t } = useLocale()
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-focus
  useEffect(() => {
    inputRef.current?.focus()
    setRecentSearches(getRecentSearches())
  }, [])

  // Debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query || query.length < 2) {
      setDebouncedQuery('')
      return
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query)
      addRecentSearch(query)
      setRecentSearches(getRecentSearches())
    }, 500)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  // Semantic search
  const { data: semanticData, isLoading: semanticLoading } = useQuery({
    queryKey: ['semantic-search', debouncedQuery],
    queryFn: async () => {
      const res = await fetch(`/api/search/semantic?q=${encodeURIComponent(debouncedQuery)}&limit=20`)
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ items: SemanticResult[]; count: number }>
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })

  // Exact search
  const { data: exactData, isLoading: exactLoading } = useQuery({
    queryKey: ['exact-search', debouncedQuery],
    queryFn: async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}`)
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ items: ExactResult[]; catalog?: CatalogResult[] }>
    },
    enabled: debouncedQuery.length >= 2,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  })

  const isLoading = semanticLoading || exactLoading
  const hasQuery = debouncedQuery.length >= 2
  const semanticItems = semanticData?.items || []
  const exactItems = exactData?.items || []
  const catalogItems = exactData?.catalog || []
  const hasResults = semanticItems.length > 0 || exactItems.length > 0 || catalogItems.length > 0

  const handleRecentClick = useCallback((search: string) => {
    setQuery(search)
  }, [])

  const handleClearRecent = useCallback(() => {
    clearRecentSearches()
    setRecentSearches([])
  }, [])

  return (
    <div className="space-y-6">
      <PageHeader icon={Sparkles} title={t('page.smartSearch')} />

      {/* Search Input */}
      <div className="relative">
        <Search className="absolute start-4 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('search.placeholder')}
          className="w-full h-14 ps-12 pe-12 text-lg rounded-xl border bg-card shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary placeholder:text-muted-foreground"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setDebouncedQuery('') }}
            className="absolute end-4 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Recent Searches */}
      {!hasQuery && recentSearches.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              {t('search.recentSearches')}
            </h3>
            <button
              onClick={handleClearRecent}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {t('search.clearRecent')}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recentSearches.map((search) => (
              <button
                key={search}
                onClick={() => handleRecentClick(search)}
                className="px-3 py-1.5 text-sm rounded-lg border bg-card hover:bg-accent transition-colors"
              >
                {search}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading State */}
      {isLoading && hasQuery && (
        <div className="space-y-4">
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <ResultSkeleton key={i} />
            ))}
          </div>
        </div>
      )}

      {/* No Results */}
      {hasQuery && !isLoading && !hasResults && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <Search className="h-12 w-12 mx-auto text-muted-foreground/50" />
            <h3 className="text-lg font-medium">{t('search.noResults')}</h3>
            <p className="text-sm text-muted-foreground">{t('search.noResultsHint')}</p>
          </CardContent>
        </Card>
      )}

      <AnimatePresence mode="wait">
        {hasQuery && !isLoading && hasResults && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            {/* Semantic Results */}
            {semanticItems.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  {t('search.semantic')}
                  <Badge variant="secondary" className="text-xs">{semanticItems.length}</Badge>
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {semanticItems.map((item, idx) => (
                    <motion.div
                      key={item.code}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                    >
                      {/* The WHOLE card is the link. It used to be a "צפה בפרטים"
                          affordance revealed on hover — which a touch screen never
                          fires, so on a phone the only way into an item was an
                          invisible target. A card-sized tap area needs no hover and
                          no aiming. */}
                      <Link
                        href={`/items/${encodeURIComponent(item.code)}`}
                        className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                      <Card className="group transition-shadow hover:shadow-md active:bg-muted/40">
                        <CardContent className="p-4 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                                <span className="font-bold text-sm">{item.code}</span>
                              </div>
                              <p className="text-sm text-muted-foreground truncate mt-1">{item.name}</p>
                            </div>
                            <RelevanceBar score={item.similarity} />
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <StockBadge qty={item.stock_qty} t={t} />
                              {item.price != null && (
                                <span className="text-sm font-medium">{formatCurrency(item.price)}</span>
                              )}
                            </div>
                            {/* A cue, not a control — the card itself is the link,
                                and a nested <a> would be invalid and steal the tap. */}
                            <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary rtl:rotate-180" />
                          </div>
                        </CardContent>
                      </Card>
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Exact Match Results */}
            {exactItems.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                  <Search className="h-4 w-4" />
                  {t('search.exact')}
                  <Badge variant="secondary" className="text-xs">{exactItems.length}</Badge>
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {exactItems.map((item, idx) => (
                    <motion.div
                      key={item.code}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                    >
                      {/* The WHOLE card is the link. It used to be a "צפה בפרטים"
                          affordance revealed on hover — which a touch screen never
                          fires, so on a phone the only way into an item was an
                          invisible target. A card-sized tap area needs no hover and
                          no aiming. */}
                      <Link
                        href={`/items/${encodeURIComponent(item.code)}`}
                        className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                      <Card className="group transition-shadow hover:shadow-md active:bg-muted/40">
                        <CardContent className="p-4 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                                <span className="font-bold text-sm">{item.code}</span>
                              </div>
                              <p className="text-sm text-muted-foreground truncate mt-1">
                                {item.name || item.description || ''}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {item.stock_qty !== undefined && (
                                <StockBadge qty={item.stock_qty} t={t} />
                              )}
                              {item.price != null && (
                                <span className="text-sm font-medium">{formatCurrency(item.price)}</span>
                              )}
                            </div>
                            {/* A cue, not a control — the card itself is the link,
                                and a nested <a> would be invalid and steal the tap. */}
                            <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary rtl:rotate-180" />
                          </div>
                        </CardContent>
                      </Card>
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Partly-catalog results: Toyota/MG codes the ERP doesn't know.
                /items/{code} brand-resolves them (PSA > MG > TOYOTA). */}
            {catalogItems.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  {t('cmd.catalog')}
                  <Badge variant="secondary" className="text-xs">{catalogItems.length}</Badge>
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {catalogItems.map((item, idx) => (
                    <motion.div
                      key={item.code}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                    >
                      {/* The WHOLE card is the link. It used to be a "צפה בפרטים"
                          affordance revealed on hover — which a touch screen never
                          fires, so on a phone the only way into an item was an
                          invisible target. A card-sized tap area needs no hover and
                          no aiming. */}
                      <Link
                        href={`/items/${encodeURIComponent(item.code)}`}
                        className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                      <Card className="group transition-shadow hover:shadow-md active:bg-muted/40">
                        <CardContent className="p-4 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                                <span className="font-bold text-sm font-mono" dir="ltr">{item.code}</span>
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium leading-none ${brandChipClasses(item.brand)}`}>
                                  {item.brand}
                                </span>
                              </div>
                              <p className="text-sm text-muted-foreground truncate mt-1" dir="auto">
                                {item.hebrewDescription || item.description || ''}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center justify-end gap-2 pt-1">
                            {/* A cue, not a control — the card itself is the link,
                                and a nested <a> would be invalid and steal the tap. */}
                            <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary rtl:rotate-180" />
                          </div>
                        </CardContent>
                      </Card>
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
