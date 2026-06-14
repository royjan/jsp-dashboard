'use client'

import { useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import {
  Search, X, ArrowRight, DollarSign, Loader2, Package,
  Share2, Check, AlertCircle,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SalesRepBottomNav } from '@/components/sales-rep/BottomNav'
import { ILS_FORMAT } from '@/lib/constants'

interface PriceResult {
  item_code: string
  name: string
  retail_price: number
  customer_price: number | null
  discount_pct: number
  stock_qty: number
  incoming_qty: number
  ordered_qty: number
  in_stock: boolean
}

type SearchState = 'idle' | 'loading' | 'result' | 'not_found' | 'error'

export default function PriceCheckPage() {
  const [itemCode, setItemCode] = useState('')
  const [customerCode, setCustomerCode] = useState('')
  const [state, setState] = useState<SearchState>('idle')
  const [result, setResult] = useState<PriceResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const itemRef = useRef<HTMLInputElement>(null)

  const doSearch = useCallback(async () => {
    const code = itemCode.trim()
    if (!code) return

    setState('loading')
    setResult(null)
    setErrorMsg('')

    try {
      const params = new URLSearchParams({ item_code: code })
      if (customerCode.trim()) {
        params.set('customer_code', customerCode.trim())
      }
      const res = await fetch(`/api/sales-rep/price-check?${params}`)
      if (res.status === 404) {
        setState('not_found')
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }))
        setErrorMsg(data.error || 'שגיאה')
        setState('error')
        return
      }
      const data: PriceResult = await res.json()
      setResult(data)
      setState('result')
    } catch {
      setErrorMsg('שגיאת רשת — בדוק חיבור')
      setState('error')
    }
  }, [itemCode, customerCode])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    doSearch()
  }

  const handleClear = () => {
    setItemCode('')
    setCustomerCode('')
    setState('idle')
    setResult(null)
    setErrorMsg('')
    itemRef.current?.focus()
  }

  const handleShare = async () => {
    if (!result) return
    const lines = [
      `${result.item_code} - ${result.name}`,
      `מחיר מחירון: ${ILS_FORMAT.format(result.retail_price)}`,
    ]
    if (result.customer_price != null) {
      lines.push(`מחיר לקוח: ${ILS_FORMAT.format(result.customer_price)}`)
      if (result.discount_pct > 0) {
        lines.push(`הנחה: ${result.discount_pct}%`)
      }
    }
    lines.push(`מלאי: ${result.stock_qty} יח'`)
    if (result.incoming_qty > 0) lines.push(`בדרך: ${result.incoming_qty}`)

    const text = lines.join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="min-h-dvh bg-background flex flex-col" dir="rtl">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 pt-4 pb-2 safe-area-top">
        <Link href="/sales-rep" className="shrink-0">
          <Button variant="ghost" size="icon" className="h-11 w-11">
            <ArrowRight className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <DollarSign className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold">בדיקת מחיר</h1>
        </div>
      </header>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="px-4 py-3 space-y-3">
        <div className="relative">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
          <input
            ref={itemRef}
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={itemCode}
            onChange={(e) => setItemCode(e.target.value)}
            placeholder='מק"ט פריט...'
            className="w-full h-14 pr-12 pl-12 rounded-xl border-2 border-input bg-background text-2xl font-mono placeholder:text-lg placeholder:font-sans focus:outline-none focus:border-primary transition-colors"
          />
          {itemCode && (
            <button
              type="button"
              onClick={handleClear}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full hover:bg-muted"
            >
              <X className="h-5 w-5 text-muted-foreground" />
            </button>
          )}
        </div>

        <input
          type="text"
          inputMode="numeric"
          value={customerCode}
          onChange={(e) => setCustomerCode(e.target.value)}
          placeholder="קוד לקוח (אופציונלי)..."
          className="w-full h-12 px-4 rounded-xl border-2 border-input bg-background text-lg font-mono placeholder:text-base placeholder:font-sans focus:outline-none focus:border-primary transition-colors"
        />

        <Button
          type="submit"
          size="lg"
          className="w-full min-h-[48px] text-lg font-bold"
          disabled={!itemCode.trim() || state === 'loading'}
        >
          {state === 'loading' ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            'בדוק מחיר'
          )}
        </Button>
      </form>

      {/* Content */}
      <div className="flex-1 px-4 pb-24 overflow-y-auto">
        {state === 'idle' && (
          <div className="flex flex-col items-center justify-center pt-12 text-center space-y-4">
            <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center">
              <DollarSign className="h-10 w-10 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-medium">בדוק מחיר פריט</p>
              <p className="text-sm text-muted-foreground">
                הוסף קוד לקוח לראות מחיר מותאם
              </p>
            </div>
          </div>
        )}

        {state === 'loading' && (
          <div className="space-y-4 pt-4">
            <Card>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-muted-foreground">טוען מחיר...</span>
                </div>
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-12 w-32" />
              </CardContent>
            </Card>
          </div>
        )}

        {state === 'result' && result && (
          <div className="space-y-4">
            {/* Item info */}
            <Card>
              <CardContent className="p-5 space-y-2">
                <p className="text-2xl font-bold font-mono">{result.item_code}</p>
                {result.name && (
                  <p className="text-lg font-medium leading-tight">{result.name}</p>
                )}
              </CardContent>
            </Card>

            {/* Prices */}
            <Card>
              <CardContent className="p-5 space-y-4">
                {/* Retail price */}
                <div className="flex justify-between items-center">
                  <span className="text-base text-muted-foreground">מחיר מחירון</span>
                  <span className="text-3xl font-bold">
                    {ILS_FORMAT.format(result.retail_price)}
                  </span>
                </div>

                {/* Customer price */}
                {result.customer_price != null && result.customer_price !== result.retail_price && (
                  <>
                    <div className="border-t" />
                    <div className="flex justify-between items-center">
                      <span className="text-base text-muted-foreground">מחיר לקוח</span>
                      <span className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                        {ILS_FORMAT.format(result.customer_price)}
                      </span>
                    </div>
                    {result.discount_pct > 0 && (
                      <div className="flex justify-between items-center">
                        <span className="text-base text-muted-foreground">הנחה</span>
                        <Badge variant="secondary" className="text-lg px-3 py-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                          {result.discount_pct}%
                        </Badge>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Stock */}
            <Card>
              <CardContent className="p-5">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">במלאי</p>
                    <p className={`text-3xl font-bold ${result.in_stock ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                      {result.stock_qty}
                    </p>
                    {!result.in_stock && (
                      <Badge variant="destructive" className="text-xs">אזל</Badge>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">בדרך</p>
                    <p className={`text-3xl font-bold ${result.incoming_qty > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                      {result.incoming_qty}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">הוזמן</p>
                    <p className={`text-3xl font-bold ${result.ordered_qty > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-muted-foreground'}`}>
                      {result.ordered_qty}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Share button */}
            <Button
              variant="outline"
              size="lg"
              className="w-full min-h-[48px] text-lg gap-2"
              onClick={handleShare}
            >
              {copied ? (
                <>
                  <Check className="h-5 w-5 text-emerald-500" />
                  הועתק!
                </>
              ) : (
                <>
                  <Share2 className="h-5 w-5" />
                  שתף מחיר
                </>
              )}
            </Button>
          </div>
        )}

        {state === 'not_found' && (
          <Card className="border-destructive/30 mt-4">
            <CardContent className="p-6 text-center space-y-3">
              <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
                <X className="h-8 w-8 text-destructive" />
              </div>
              <p className="text-xl font-bold">פריט לא נמצא</p>
              <p className="text-muted-foreground">בדוק שהמק&quot;ט נכון</p>
            </CardContent>
          </Card>
        )}

        {state === 'error' && (
          <Card className="border-destructive/30 mt-4">
            <CardContent className="p-6 text-center space-y-3">
              <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
              <p className="text-xl font-bold text-destructive">שגיאה</p>
              <p className="text-muted-foreground">{errorMsg}</p>
              <Button onClick={doSearch} variant="outline" className="min-h-[44px]">
                נסה שוב
              </Button>
            </CardContent>
          </Card>
        )}
      </div>

      <SalesRepBottomNav />
    </div>
  )
}
