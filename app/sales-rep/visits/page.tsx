'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight, ClipboardList, CalendarCheck, TrendingUp,
  Users, Loader2, Filter, ChevronDown, ClipboardPlus,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SalesRepBottomNav } from '@/components/sales-rep/BottomNav'
import { VisitLogger } from '@/components/sales-rep/VisitLogger'
import { formatNumber } from '@/lib/constants'

const OUTCOME_LABELS: Record<string, { label: string; color: string }> = {
  interested: { label: 'מעוניין', color: 'bg-blue-500/10 text-blue-700 dark:text-blue-400' },
  ordered: { label: 'הזמין', color: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  not_interested: { label: 'לא מעוניין', color: 'bg-red-500/10 text-red-700 dark:text-red-400' },
  follow_up: { label: 'מעקב', color: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' },
}

const VISIT_TYPE_LABELS: Record<string, string> = {
  planned: 'מתוכנן',
  walk_in: 'מזדמן',
}

interface Visit {
  id: string
  repName: string
  customerCode: string
  customerName: string
  visitDate: string
  visitType: string
  notes: string | null
  itemsShown: string[]
  outcome: string
  followUpDate: string | null
  createdAt: string
}

export default function VisitHistoryPage() {
  const [filterOutcome, setFilterOutcome] = useState<string>('all')
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [showVisitLogger, setShowVisitLogger] = useState(false)
  const [daysBack, setDaysBack] = useState(30)

  const repName = typeof window !== 'undefined'
    ? localStorage.getItem('sales-rep-name') || ''
    : ''

  const { data, isLoading } = useQuery({
    queryKey: ['sales-rep-visits', repName, daysBack],
    queryFn: async () => {
      const params = new URLSearchParams({ days: String(daysBack) })
      if (repName) params.set('rep_name', repName)
      const res = await fetch(`/api/sales-rep/visits?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 2 * 60 * 1000,
  })

  const visits: Visit[] = data?.visits || []
  const stats = data?.stats || { total: 0, thisWeek: 0, conversionRate: 0, topVisited: [] }

  const filtered = useMemo(() => {
    if (filterOutcome === 'all') return visits
    return visits.filter((v) => v.outcome === filterOutcome)
  }, [visits, filterOutcome])

  // Group by date
  const grouped = useMemo(() => {
    const groups: Record<string, Visit[]> = {}
    for (const v of filtered) {
      const date = v.visitDate
      if (!groups[date]) groups[date] = []
      groups[date].push(v)
    }
    return Object.entries(groups).sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

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
          <ClipboardList className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold">היסטוריית ביקורים</h1>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="mr-auto h-11 w-11"
          onClick={() => setShowVisitLogger(true)}
        >
          <ClipboardPlus className="h-5 w-5" />
        </Button>
      </header>

      {/* Stats */}
      <div className="px-4 py-3">
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-3 text-center">
              <CalendarCheck className="h-5 w-5 mx-auto text-blue-500 mb-1" />
              <p className="text-2xl font-bold">
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : formatNumber(stats.thisWeek)}
              </p>
              <p className="text-[11px] text-muted-foreground">השבוע</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <TrendingUp className="h-5 w-5 mx-auto text-emerald-500 mb-1" />
              <p className="text-2xl font-bold">
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : `${stats.conversionRate}%`}
              </p>
              <p className="text-[11px] text-muted-foreground">המרה</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <Users className="h-5 w-5 mx-auto text-purple-500 mb-1" />
              <p className="text-2xl font-bold">
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : formatNumber(stats.total)}
              </p>
              <p className="text-[11px] text-muted-foreground">סה&quot;כ</p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 pb-2 flex gap-2 items-center flex-wrap">
        <div className="relative">
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full border bg-background text-sm min-h-[36px]"
          >
            <Filter className="h-3.5 w-3.5" />
            {filterOutcome === 'all' ? 'כל התוצאות' : OUTCOME_LABELS[filterOutcome]?.label || filterOutcome}
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {showFilterMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowFilterMenu(false)} />
              <div className="absolute top-full mt-1 right-0 z-50 bg-background border rounded-xl shadow-lg py-1 min-w-[140px]">
                <button
                  onClick={() => { setFilterOutcome('all'); setShowFilterMenu(false) }}
                  className="w-full text-right px-4 py-2.5 text-sm hover:bg-accent min-h-[40px]"
                >
                  כל התוצאות
                </button>
                {Object.entries(OUTCOME_LABELS).map(([key, { label }]) => (
                  <button
                    key={key}
                    onClick={() => { setFilterOutcome(key); setShowFilterMenu(false) }}
                    className="w-full text-right px-4 py-2.5 text-sm hover:bg-accent min-h-[40px]"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Days back filter */}
        <div className="flex gap-1.5">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDaysBack(d)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium min-h-[36px] transition-colors ${
                daysBack === d
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground'
              }`}
            >
              {d} יום
            </button>
          ))}
        </div>
      </div>

      {/* Visit list */}
      <div className="flex-1 px-4 pb-24 overflow-y-auto space-y-4">
        {isLoading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
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

        {!isLoading && filtered.length === 0 && (
          <div className="text-center pt-12 space-y-2">
            <ClipboardList className="h-12 w-12 mx-auto text-muted-foreground" />
            <p className="text-lg text-muted-foreground">אין ביקורים</p>
          </div>
        )}

        {/* Top visited */}
        {!isLoading && stats.topVisited?.length > 0 && filterOutcome === 'all' && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">הכי מבוקרים</h3>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {stats.topVisited.map((tv: any) => (
                <Card key={tv.code} className="shrink-0">
                  <CardContent className="p-3 text-center min-w-[100px]">
                    <p className="text-sm font-semibold truncate max-w-[100px]">{tv.name}</p>
                    <p className="text-2xl font-bold text-primary">{formatNumber(tv.count)}</p>
                    <p className="text-[10px] text-muted-foreground">ביקורים</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Grouped by date */}
        {grouped.map(([date, dateVisits]) => (
          <div key={date} className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground sticky top-0 bg-background py-1 z-10">
              {new Date(date).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}
            </h3>
            {dateVisits.map((visit) => {
              const outcomeInfo = OUTCOME_LABELS[visit.outcome] || { label: visit.outcome, color: 'bg-secondary' }
              return (
                <Card key={visit.id}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-base font-semibold truncate">{visit.customerName}</p>
                        <p className="text-sm text-muted-foreground font-mono">{visit.customerCode}</p>
                      </div>
                      <Badge variant="secondary" className={`shrink-0 ${outcomeInfo.color}`}>
                        {outcomeInfo.label}
                      </Badge>
                    </div>

                    <div className="flex gap-2 text-sm text-muted-foreground">
                      <Badge variant="outline" className="text-xs">
                        {VISIT_TYPE_LABELS[visit.visitType] || visit.visitType}
                      </Badge>
                      {visit.followUpDate && (
                        <Badge variant="outline" className="text-xs text-amber-700 dark:text-amber-400">
                          מעקב: {new Date(visit.followUpDate).toLocaleDateString('he-IL')}
                        </Badge>
                      )}
                    </div>

                    {visit.notes && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{visit.notes}</p>
                    )}

                    {visit.itemsShown && visit.itemsShown.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {visit.itemsShown.map((code: string) => (
                          <Badge key={code} variant="secondary" className="font-mono text-xs">
                            {code}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        ))}
      </div>

      {/* Quick log visit FAB - for logging without a customer selected */}
      {showVisitLogger && (
        <QuickVisitLogger onClose={() => setShowVisitLogger(false)} />
      )}

      <SalesRepBottomNav />
    </div>
  )
}

/** A quick visit logger that lets you select a customer first */
function QuickVisitLogger({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<{ code: string; name: string } | null>(null)

  // Use cached customers
  const customers = useMemo(() => {
    try {
      const cached = localStorage.getItem('sales-rep-customers-cache')
      if (cached) return JSON.parse(cached) as Array<{ code: string; name: string }>
    } catch { /* */ }
    return []
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return customers.slice(0, 20)
    const q = search.toLowerCase()
    return customers
      .filter((c: any) => c.name.toLowerCase().includes(q) || c.code.includes(q))
      .slice(0, 20)
  }, [customers, search])

  if (selected) {
    return <VisitLogger customerCode={selected.code} customerName={selected.name} onClose={onClose} />
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-background rounded-t-2xl max-h-[80vh] overflow-hidden safe-area-bottom">
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">בחר לקוח</h2>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-muted min-h-[44px] min-w-[44px] flex items-center justify-center">
              <span className="sr-only">Close</span>
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חפש לקוח..."
            autoFocus
            className="w-full h-12 px-4 rounded-xl border-2 border-input bg-background text-lg focus:outline-none focus:border-primary transition-colors"
          />
        </div>
        <div className="overflow-y-auto max-h-[50vh]">
          {filtered.map((c: any) => (
            <button
              key={c.code}
              onClick={() => setSelected({ code: c.code, name: c.name })}
              className="w-full text-right px-4 py-3 border-b hover:bg-accent transition-colors min-h-[52px]"
            >
              <p className="font-semibold">{c.name}</p>
              <p className="text-sm text-muted-foreground font-mono">{c.code}</p>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="p-4 text-center text-muted-foreground">לא נמצאו לקוחות</p>
          )}
        </div>
      </div>
    </div>
  )
}
