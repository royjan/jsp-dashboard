'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { Search, X, ArrowRight, Package, Loader2, ScanBarcode, History, MapPin } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber } from '@/lib/constants'

// ── Types ──

interface Warehouse {
  warehouse: string
  stock_qty: number
  incoming_qty: number
  ordered_qty: number
}

interface QuickCheckResult {
  code: string
  canonical_code: string
  canonical_name: string
  description: string | null
  stock_qty: number
  incoming_qty: number
  ordered_qty: number
  warehouses: Warehouse[]
  retail_price: number | null
  history_chain: string[]
  last_sale_date: string | null
  sold_this_year: number | null
  sold_last_year: number | null
  place: string | null
}

type SearchState = 'idle' | 'loading' | 'result' | 'not_found' | 'error'

// ── localStorage helpers ──

const STORAGE_KEY = 'quick-check-recent'

function getRecentSearches(): string[] {
  if (typeof window === 'undefined') return []
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function addRecentSearch(code: string) {
  const recent = getRecentSearches().filter((c) => c !== code)
  recent.unshift(code)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recent.slice(0, 10)))
}

// ── Component ──

export default function QuickCheckPage() {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<SearchState>('idle')
  const [result, setResult] = useState<QuickCheckResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setRecentSearches(getRecentSearches())
    // Auto-focus on mount for barcode scanner
    inputRef.current?.focus()
  }, [])

  const doSearch = useCallback(async (code: string) => {
    const trimmed = code.trim()
    if (!trimmed) return

    setState('loading')
    setResult(null)
    setErrorMsg('')

    try {
      const res = await fetch(`/api/stock/quick-check?code=${encodeURIComponent(trimmed)}`)
      if (res.status === 404) {
        setState('not_found')
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        setErrorMsg(data.error || 'שגיאה בשרת')
        setState('error')
        return
      }
      const data: QuickCheckResult = await res.json()
      setResult(data)
      setState('result')

      // Save to recent
      addRecentSearch(trimmed.toUpperCase())
      setRecentSearches(getRecentSearches())
    } catch {
      setErrorMsg('שגיאת רשת — בדוק חיבור')
      setState('error')
    }
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    doSearch(query)
  }

  const handleClear = () => {
    setQuery('')
    setState('idle')
    setResult(null)
    setErrorMsg('')
    inputRef.current?.focus()
  }

  const handleRecentClick = (code: string) => {
    setQuery(code)
    doSearch(code)
  }

  return (
    <div className="min-h-dvh bg-background flex flex-col" dir="rtl">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 pt-4 pb-2 safe-area-top">
        <Link href="/" className="shrink-0">
          <Button variant="ghost" size="icon" className="h-11 w-11">
            <ArrowRight className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <ScanBarcode className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold">בדיקת מלאי</h1>
        </div>
      </header>

      {/* Search bar */}
      <form onSubmit={handleSubmit} className="px-4 py-3">
        <div className="relative">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='הקלד מק"ט או סרוק ברקוד...'
            className="w-full h-14 pr-13 pl-12 rounded-xl border-2 border-input bg-background text-2xl font-mono placeholder:text-lg placeholder:font-sans focus:outline-none focus:border-primary transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full hover:bg-muted transition-colors"
            >
              <X className="h-5 w-5 text-muted-foreground" />
            </button>
          )}
        </div>
      </form>

      {/* Content area */}
      <div className="flex-1 px-4 pb-8 safe-area-bottom overflow-y-auto">
        {/* Idle state */}
        {state === 'idle' && (
          <div className="space-y-6">
            {/* Recent searches */}
            {recentSearches.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <History className="h-4 w-4" />
                  <span>חיפושים אחרונים</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recentSearches.map((code) => (
                    <button
                      key={code}
                      onClick={() => handleRecentClick(code)}
                      className="px-4 py-2.5 rounded-full bg-secondary text-secondary-foreground font-mono text-base hover:bg-secondary/80 transition-colors min-h-[44px]"
                    >
                      {code}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state illustration */}
            <div className="flex flex-col items-center justify-center pt-12 text-center space-y-4">
              <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center">
                <Package className="h-10 w-10 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="text-lg font-medium">חפש פריט לבדיקת מלאי</p>
                <p className="text-sm text-muted-foreground">
                  הקלד מספר פריט או סרוק ברקוד עם הסורק
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Loading state */}
        {state === 'loading' && <LoadingSkeleton />}

        {/* Result */}
        {state === 'result' && result && <ResultCard result={result} />}

        {/* Not found */}
        {state === 'not_found' && (
          <Card className="border-destructive/30">
            <CardContent className="p-6 text-center space-y-3">
              <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
                <X className="h-8 w-8 text-destructive" />
              </div>
              <div className="space-y-1">
                <p className="text-xl font-bold">פריט לא נמצא</p>
                <p className="text-muted-foreground">
                  בדוק שהמק&quot;ט נכון ונסה שוב
                </p>
              </div>
              {query && (
                <p className="font-mono text-lg text-muted-foreground">{query.toUpperCase()}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {state === 'error' && (
          <Card className="border-destructive/30">
            <CardContent className="p-6 text-center space-y-3">
              <p className="text-xl font-bold text-destructive">שגיאה</p>
              <p className="text-muted-foreground">{errorMsg}</p>
              <Button onClick={() => doSearch(query)} variant="outline" className="min-h-[44px]">
                נסה שוב
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Recent searches (shown below result too) */}
        {state !== 'idle' && recentSearches.length > 0 && (
          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <History className="h-4 w-4" />
              <span>חיפושים אחרונים</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {recentSearches.map((code) => (
                <button
                  key={code}
                  onClick={() => handleRecentClick(code)}
                  className="px-4 py-2.5 rounded-full bg-secondary text-secondary-foreground font-mono text-base hover:bg-secondary/80 transition-colors min-h-[44px]"
                >
                  {code}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Result Card ──

function ResultCard({ result }: { result: QuickCheckResult }) {
  const hasMultipleWarehouses = result.warehouses.length > 1
  const previousCodes = result.history_chain.filter((c) => c !== result.canonical_code)

  return (
    <div className="space-y-4">
      {/* Item header */}
      <Card>
        <CardContent className="p-5 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <p className="text-2xl font-bold font-mono tracking-wide">{result.canonical_code}</p>
              {result.canonical_name && (
                <p className="text-lg font-medium leading-tight">{result.canonical_name}</p>
              )}
              {result.description && result.description !== result.canonical_name && (
                <p className="text-sm text-muted-foreground">{result.description}</p>
              )}
            </div>
            {result.retail_price != null && result.retail_price > 0 && (
              <div className="text-left shrink-0">
                <p className="text-sm text-muted-foreground">מחיר</p>
                <p className="text-2xl font-bold">
                  {result.retail_price.toLocaleString('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 })}
                </p>
              </div>
            )}
          </div>

          {result.place && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" />
              <span>מיקום: {result.place}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stock summary — big color-coded numbers */}
      <Card>
        <CardContent className="p-5">
          <div className="grid grid-cols-3 gap-4 text-center">
            {/* In stock */}
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">במלאי</p>
              <p className={`text-3xl font-bold ${result.stock_qty > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {formatNumber(result.stock_qty)}
              </p>
              {result.stock_qty === 0 && (
                <Badge variant="destructive" className="text-xs">אזל</Badge>
              )}
            </div>

            {/* Incoming */}
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">בדרך</p>
              <p className={`text-3xl font-bold ${result.incoming_qty > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                {formatNumber(result.incoming_qty)}
              </p>
            </div>

            {/* Ordered */}
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">הוזמן</p>
              <p className={`text-3xl font-bold ${result.ordered_qty > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>
                {formatNumber(result.ordered_qty)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-warehouse breakdown */}
      {hasMultipleWarehouses && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <p className="text-sm font-medium text-muted-foreground">פירוט לפי מחסן</p>
            <div className="divide-y">
              {result.warehouses.map((wh) => (
                <div key={wh.warehouse} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <span className="text-base font-medium">{wh.warehouse}</span>
                  <div className="flex gap-4 text-base">
                    <span className={wh.stock_qty > 0 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-muted-foreground'}>
                      {formatNumber(wh.stock_qty)}
                    </span>
                    {wh.incoming_qty > 0 && (
                      <span className="text-amber-600 dark:text-amber-400">+{formatNumber(wh.incoming_qty)}</span>
                    )}
                    {wh.ordered_qty > 0 && (
                      <span className="text-blue-600 dark:text-blue-400">{formatNumber(wh.ordered_qty)} הוזמן</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* History chain + last sale */}
      {(previousCodes.length > 0 || result.last_sale_date || result.sold_this_year != null) && (
        <Card>
          <CardContent className="p-5 space-y-3">
            {previousCodes.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">קודים קודמים</p>
                <div className="flex flex-wrap gap-2">
                  {previousCodes.map((code) => (
                    <Badge key={code} variant="secondary" className="font-mono text-sm px-3 py-1">
                      {code}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {result.last_sale_date && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">מכירה אחרונה</span>
                <span className="text-base font-medium">
                  {new Date(result.last_sale_date).toLocaleDateString('he-IL')}
                </span>
              </div>
            )}

            {result.sold_this_year != null && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">נמכר השנה</span>
                <span className="text-base font-bold">{formatNumber(result.sold_this_year)}</span>
              </div>
            )}

            {result.sold_last_year != null && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">נמכר שנה שעברה</span>
                <span className="text-base">{formatNumber(result.sold_last_year)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ── Loading Skeleton ──

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-muted-foreground">טוען נתונים...</span>
          </div>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-5 w-60" />
          <Skeleton className="h-4 w-32" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="space-y-2">
              <Skeleton className="h-4 w-12 mx-auto" />
              <Skeleton className="h-10 w-16 mx-auto" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-12 mx-auto" />
              <Skeleton className="h-10 w-16 mx-auto" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-12 mx-auto" />
              <Skeleton className="h-10 w-16 mx-auto" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}
