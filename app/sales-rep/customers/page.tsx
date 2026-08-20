'use client'

import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import {
  Search, X, Loader2, ArrowRight, ChevronDown, ChevronUp,
  Users, ClipboardPlus,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SalesRepBottomNav } from '@/components/sales-rep/BottomNav'
import { VisitLogger } from '@/components/sales-rep/VisitLogger'
import { formatCurrency, formatNumber } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { isDeclineHidden } from '@/lib/privacy'

interface Customer {
  code: string
  name: string
  score: number
  band: 'green' | 'yellow' | 'red'
  total_revenue: number
  last_purchase: string
  days_since_order: number | null
  factors: {
    returnRate: number
    daysSinceLastPurchase: number | null
    trend: string
    yoyChangePct: number | null
  }
}

const BAND_COLORS: Record<string, string> = {
  red: 'bg-red-500',
  yellow: 'bg-amber-500',
  green: 'bg-emerald-500',
}

const BAND_LABELS: Record<string, string> = {
  red: 'בסיכון',
  yellow: 'מעקב',
  green: 'בריא',
}

export default function SalesRepCustomersPage() {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const [search, setSearch] = useState('')
  const [expandedCode, setExpandedCode] = useState<string | null>(null)
  const [visitCustomer, setVisitCustomer] = useState<{ code: string; name: string } | null>(null)
  const [filterBand, setFilterBand] = useState<string>('all')

  const { data, isLoading, error } = useQuery({
    queryKey: ['sales-rep-customers'],
    queryFn: async () => {
      const res = await fetch('/api/sales-rep/customers')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  // Cache locally
  useEffect(() => {
    if (data?.customers) {
      try {
        localStorage.setItem('sales-rep-customers-cache', JSON.stringify(data.customers))
      } catch { /* quota exceeded */ }
    }
  }, [data])

  // Use cached data while loading
  const customers: Customer[] = useMemo(() => {
    const raw = data?.customers || []
    if (raw.length === 0 && isLoading) {
      try {
        const cached = localStorage.getItem('sales-rep-customers-cache')
        if (cached) return JSON.parse(cached)
      } catch { /* */ }
    }
    return raw
  }, [data, isLoading])

  const filtered = useMemo(() => {
    let list = customers
    if (filterBand !== 'all') {
      list = list.filter((c) => c.band === filterBand)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (c) => c.name.toLowerCase().includes(q) || c.code.includes(q)
      )
    }
    return list
  }, [customers, search, filterBand])

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
          <Users className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold">לקוחות</h1>
        </div>
        {data?.summary && (
          <div className="mr-auto flex gap-2">
            <Badge variant="destructive" className="text-xs">{formatNumber(data.summary.red)}</Badge>
            <Badge className="text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400">{formatNumber(data.summary.yellow)}</Badge>
            <Badge variant="secondary" className="text-xs">{formatNumber(data.summary.green)}</Badge>
          </div>
        )}
      </header>

      {/* Search */}
      <div className="px-4 py-2 space-y-2">
        <div className="relative">
          <Search className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חפש לקוח..."
            className="w-full h-12 pr-12 pl-10 rounded-xl border-2 border-input bg-background text-lg focus:outline-none focus:border-primary transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 rounded-full hover:bg-muted"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Band filter */}
        <div className="flex gap-2">
          {[
            { key: 'all', label: 'הכל' },
            { key: 'red', label: 'בסיכון' },
            { key: 'yellow', label: 'מעקב' },
            { key: 'green', label: 'בריא' },
          ].map((opt) => (
            <button
              key={opt.key}
              onClick={() => setFilterBand(opt.key)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors min-h-[36px] ${
                filterBand === opt.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 px-4 pb-24 overflow-y-auto space-y-2">
        {isLoading && customers.length === 0 && (
          <div className="space-y-3 pt-4">
            {[...Array(5)].map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-24" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {error && (
          <Card className="border-destructive/30 mt-4">
            <CardContent className="p-4 text-center text-destructive">
              שגיאה בטעינת לקוחות
            </CardContent>
          </Card>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="text-center pt-12 space-y-2">
            <Users className="h-12 w-12 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground">לא נמצאו לקוחות</p>
          </div>
        )}

        {filtered.map((customer) => {
          const isExpanded = expandedCode === customer.code
          return (
            <Card key={customer.code} className="overflow-hidden">
              <CardContent className="p-0">
                {/* Main row */}
                <button
                  onClick={() => setExpandedCode(isExpanded ? null : customer.code)}
                  className="w-full p-4 flex items-center gap-3 text-right min-h-[64px]"
                >
                  <span className={`h-3.5 w-3.5 rounded-full shrink-0 ${BAND_COLORS[customer.band]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-semibold truncate">{customer.name}</p>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span className="font-mono">{customer.code}</span>
                      {customer.days_since_order != null && (
                        <span>{customer.days_since_order} ימים</span>
                      )}
                    </div>
                  </div>
                  <div className="text-left shrink-0 flex items-center gap-2">
                    <div>
                      <p className="text-sm font-bold">{formatCurrency(customer.total_revenue)}</p>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] ${
                          customer.band === 'red'
                            ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                            : customer.band === 'yellow'
                            ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                            : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {BAND_LABELS[customer.band]}
                      </Badge>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t pt-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">רכישה אחרונה</p>
                        <p className="font-medium">
                          {customer.last_purchase
                            ? new Date(customer.last_purchase).toLocaleDateString('he-IL')
                            : 'לא ידוע'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">ציון בריאות</p>
                        <p className="font-medium">{customer.score}/100</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">שיעור החזרות</p>
                        <p className="font-medium">{Math.round(customer.factors.returnRate * 100)}%</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">שינוי שנתי</p>
                        <p className="font-medium">
                          {customer.factors.yoyChangePct != null
                            && !isDeclineHidden(customer.factors.yoyChangePct < 0)
                            ? `${customer.factors.yoyChangePct > 0 ? '+' : ''}${Math.round(customer.factors.yoyChangePct)}%`
                            : '—'}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        variant="default"
                        size="sm"
                        className="flex-1 min-h-[44px] text-base"
                        onClick={() => setVisitCustomer({ code: customer.code, name: customer.name })}
                      >
                        <ClipboardPlus className="h-4 w-4 ml-2" />
                        רשום ביקור
                      </Button>
                      <Link href={`/customers/${customer.code}`} className="flex-1">
                        <Button variant="outline" size="sm" className="w-full min-h-[44px] text-base">
                          צפה בהיסטוריה
                        </Button>
                      </Link>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Visit logger modal */}
      {visitCustomer && (
        <VisitLogger
          customerCode={visitCustomer.code}
          customerName={visitCustomer.name}
          onClose={() => setVisitCustomer(null)}
        />
      )}

      <SalesRepBottomNav />
    </div>
  )
}
