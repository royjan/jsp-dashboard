'use client'

import { useState, useCallback, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { motion, AnimatePresence } from 'framer-motion'
import { useStockForecast, useItemStockForecast } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AnimatedCounter } from '@/components/shared/AnimatedCounter'
import { cn } from '@/lib/utils'
import { AlertTriangle, Clock, ShieldAlert, Eye, TrendingDown, ArrowLeft, Search, Filter, Truck, X, Download, Loader2 } from 'lucide-react'
import { EbayRecommendButton } from '@/components/shared/EbayRecommendButton'
import { ItemLink } from '@/components/shared/ItemLink'
import { SortableTh } from '@/components/shared/sortable-table'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart } from 'recharts'
import { ILS_FORMAT, formatNumber } from '@/lib/constants'

type UrgencyLevel = 'critical' | 'warning' | 'watch' | 'ok'

const URGENCY_CONFIG: Record<UrgencyLevel, { color: string; bgColor: string; borderColor: string; label: { he: string; en: string } }> = {
  critical: { color: 'text-red-700 dark:text-red-400', bgColor: 'bg-red-100 dark:bg-red-950', borderColor: 'border-red-200 dark:border-red-800', label: { he: 'קריטי', en: 'Critical' } },
  warning: { color: 'text-amber-700 dark:text-amber-400', bgColor: 'bg-amber-100 dark:bg-amber-950', borderColor: 'border-amber-200 dark:border-amber-800', label: { he: 'אזהרה', en: 'Warning' } },
  watch: { color: 'text-blue-700 dark:text-blue-400', bgColor: 'bg-blue-100 dark:bg-blue-950', borderColor: 'border-blue-200 dark:border-blue-800', label: { he: 'מעקב', en: 'Watch' } },
  ok: { color: 'text-green-700 dark:text-green-400', bgColor: 'bg-green-100 dark:bg-green-950', borderColor: 'border-green-200 dark:border-green-800', label: { he: 'תקין', en: 'OK' } },
}

function UrgencyBadge({ urgency, locale }: { urgency: UrgencyLevel; locale: 'he' | 'en' }) {
  const config = URGENCY_CONFIG[urgency] || URGENCY_CONFIG.ok
  return (
    <Badge variant="outline" className={cn('text-xs font-semibold', config.color, config.bgColor, config.borderColor)}>
      {config.label[locale]}
    </Badge>
  )
}

function formatDate(dateStr: string | null | undefined, locale: 'he' | 'en'): string {
  if (!dateStr) return locale === 'he' ? 'לא ידוע' : 'Unknown'
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function ForecastChart({ itemCode }: { itemCode: string }) {
  const { data, isLoading, error } = useItemStockForecast(itemCode)
  const { locale } = useLocale()

  if (isLoading) return <Skeleton className="h-64 w-full" />
  if (error || !data) return <div className="text-sm text-muted-foreground p-4">{locale === 'he' ? 'שגיאה בטעינת תחזית' : 'Error loading forecast'}</div>

  const projections = data.monthly_projections || []
  if (projections.length === 0) return <div className="text-sm text-muted-foreground p-4">{locale === 'he' ? 'אין נתוני תחזית' : 'No forecast data'}</div>

  const chartData = [
    { month: locale === 'he' ? 'עכשיו' : 'Now', stock: data.current_stock, demand: 0 },
    ...projections.map((p: any) => ({
      month: p.month,
      stock: p.projected_stock,
      demand: p.predicted_demand,
    })),
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="text-center">
          <div className="text-xs text-muted-foreground">{locale === 'he' ? 'מלאי נוכחי' : 'Current Stock'}</div>
          <div className="text-lg font-bold">{formatNumber(data.current_stock)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-muted-foreground">{locale === 'he' ? 'הוזמן / בדרך' : 'Ordered / In Transit'}</div>
          <div className="text-lg font-bold">
            {formatNumber(data.ordered_qty ?? 0)} / {formatNumber(data.incoming_qty ?? 0)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-muted-foreground">{locale === 'he' ? 'ביקוש חודשי צפוי' : 'Predicted Monthly Demand'}</div>
          <div className="text-lg font-bold">{formatNumber(data.predicted_monthly_demand)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-muted-foreground">{locale === 'he' ? 'תאריך אזילה' : 'Stock-out Date'}</div>
          <div className="text-lg font-bold">{formatDate(data.stock_out_date, locale)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-muted-foreground">{locale === 'he' ? 'אמינות תחזית' : 'Reliability'}</div>
          <div className="text-lg font-bold">{Math.round((data.confidence || 0) * 100)}%</div>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="stockGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="month" className="text-xs" tick={{ fontSize: 11 }} />
          <YAxis className="text-xs" tick={{ fontSize: 11 }} />
          <Tooltip
            contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
            labelStyle={{ fontWeight: 600 }}
          />
          <ReferenceLine y={0} stroke="hsl(var(--destructive))" strokeDasharray="3 3" label={{ value: locale === 'he' ? 'אזילה' : 'Stock-out', position: 'right', fontSize: 11 }} />
          <Area type="monotone" dataKey="stock" stroke="hsl(var(--primary))" fill="url(#stockGradient)" name={locale === 'he' ? 'מלאי צפוי' : 'Projected Stock'} strokeWidth={2} />
          <Line type="monotone" dataKey="demand" stroke="hsl(var(--destructive))" name={locale === 'he' ? 'ביקוש חודשי' : 'Monthly Demand'} strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
        </AreaChart>
      </ResponsiveContainer>

      {data.historical_monthly && data.historical_monthly.length > 0 && (
        <div className="mt-4">
          <h4 className="text-sm font-medium mb-2">{locale === 'he' ? 'היסטוריית מכירות חודשית' : 'Monthly Sales History'}</h4>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={data.historical_monthly} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} tickFormatter={(v: number) => String(v)} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
              <Line type="monotone" dataKey="quantity" stroke="hsl(var(--chart-2))" name={locale === 'he' ? 'כמות' : 'Quantity'} strokeWidth={1.5} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

export default function StockForecastPage() {
  const { t, locale, dir } = useLocale()
  const isRTL = dir === 'rtl'
  const [urgencyFilter, setUrgencyFilter] = useState<string | undefined>(undefined)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedItem, setExpandedItem] = useState<string | null>(null)

  const [rowLimit, setRowLimit] = useState(200)
  const [isExporting, setIsExporting] = useState(false)
  // Sort and search run on the server over the full result set — sorting only
  // the loaded rows would rank a slice, so e.g. the truly least-reliable items
  // would never surface. Debounce the search so typing doesn't spam the API.
  const [sortKey, setSortKey] = useState<string>('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300)
    return () => clearTimeout(id)
  }, [searchQuery])

  // SortableTh is generic over the row type, so its key is string|number|symbol.
  const toggleSort = (key: string | number | symbol) => {
    const k = String(key)
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('asc') }
  }

  const { data, isLoading, error, isFetching } = useStockForecast(urgencyFilter, rowLimit, {
    q: debouncedSearch,
    sort: sortKey,
    dir: sortDir,
  })

  const items: any[] = data?.items || []
  // Counts come from the API over the full result set; the rows below are
  // capped at rowLimit, so counting them here would under-report.
  const summary = data?.summary as
    | { critical: number; warning: number; watch: number; total: number; value_at_risk: number }
    | undefined

  // The server already filtered, sorted and paged these — render as received.
  // (Re-sorting here would silently re-rank just the loaded slice.)
  const filteredItems = items
  const sortedItems = items

  // KPI calculations — prefer the API's whole-set totals, fall back to the
  // loaded rows for older cached payloads that predate `summary`.
  const criticalCount = summary?.critical ?? items.filter((i: any) => i.urgency === 'critical').length
  const warningCount = summary?.warning ?? items.filter((i: any) => i.urgency === 'warning').length
  const watchCount = summary?.watch ?? items.filter((i: any) => i.urgency === 'watch').length
  const totalValueAtRisk = summary?.value_at_risk ?? items
    .filter((i: any) => i.urgency === 'critical' || i.urgency === 'warning')
    .reduce((sum: number, i: any) => sum + (i.current_stock || 0) * (i.price || 0), 0)

  const he = locale === 'he'

  // Exports exactly what's on screen (current urgency filter, search and sort),
  // plus the fields the table only shows in tooltips. Raw numbers, not
  // formatNumber() strings, so the columns stay summable in Excel.
  const exportToExcel = useCallback(async () => {
    if (!sortedItems.length) return
    setIsExporting(true)
    // Export the whole result set, not the page. The table is capped by the
    // Rows selector, so exporting what's rendered would silently truncate the
    // file; re-fetch with the same filter/search/sort and no meaningful cap.
    let exportItems: any[] = sortedItems
    try {
      const params = new URLSearchParams({ limit: String(Math.max(summary?.total ?? 0, rowLimit)) })
      if (urgencyFilter) params.set('urgency', urgencyFilter)
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (sortKey) { params.set('sort', sortKey); params.set('dir', sortDir) }
      const res = await fetch(`/api/analytics/stock-forecast?${params}`)
      if (res.ok) {
        const full = await res.json()
        if (Array.isArray(full?.items) && full.items.length) exportItems = full.items
      }
    } catch {
      // Fall back to the rows already on screen rather than failing the export.
    }

    try {
    const rows = exportItems.map((item: any, i: number) => ({
      '#': i + 1,
      [he ? 'קוד' : 'Code']: item.item_code,
      [he ? 'שם' : 'Name']: item.item_name,
      [he ? 'מלאי במחסן' : 'On Hand']: item.current_stock ?? 0,
      [he ? 'הוזמן' : 'Ordered']: item.ordered_qty ?? 0,
      [he ? 'בדרך' : 'In Transit']: item.incoming_qty ?? 0,
      [he ? 'סה״כ בדרך' : 'Pipeline']: item.pipeline_qty ?? 0,
      [he ? 'ביקוש חודשי' : 'Monthly Demand']: item.predicted_monthly_demand ?? 0,
      [he ? 'תאריך אזילה' : 'Stock-out Date']: formatDate(item.stock_out_date, locale),
      [he ? 'ימים עד אזילה' : 'Days Left']: item.days_until_stockout ?? '',
      [he ? 'ימים כולל בדרך' : 'Days Incl. Pipeline']: item.days_with_pipeline ?? '',
      [he ? 'אמינות תחזית %' : 'Reliability %']: Math.round((item.confidence || 0) * 100),
      [he ? 'דחיפות' : 'Urgency']:
        (URGENCY_CONFIG[item.urgency as UrgencyLevel] || URGENCY_CONFIG.ok).label[locale],
      [he ? 'מחיר' : 'Price']: Math.round(item.price || 0),
      [he ? 'ערך מלאי' : 'Stock Value']: Math.round((item.current_stock || 0) * (item.price || 0)),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [
      { wch: 5 }, { wch: 14 }, { wch: 40 }, { wch: 12 }, { wch: 9 }, { wch: 9 },
      { wch: 11 }, { wch: 13 }, { wch: 14 }, { wch: 13 }, { wch: 15 },
      { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
    ]
    if (he) ws['!dir'] = 'rtl'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, he ? 'תחזית אזילה' : 'Stock Forecast')
    XLSX.writeFile(wb, `stock-forecast-${new Date().toISOString().split('T')[0]}.xlsx`)
    } finally {
      setIsExporting(false)
    }
  }, [sortedItems, he, locale, summary, rowLimit, urgencyFilter, debouncedSearch, sortKey, sortDir])

  // Plain-language column explanations (shown on header hover).
  const hints = he
    ? {
        code: 'מספר הפריט בקטלוג',
        name: 'שם הפריט',
        stock: 'כמות שנמצאת פיזית במחסן כרגע',
        pipeline: 'הוזמן מהספק או בדרך אלינו — עדיין לא במחסן',
        demand: 'כמה יחידות נמכרות בחודש בממוצע, לפי היסטוריית המכירות',
        date: 'התאריך שבו המלאי צפוי להיגמר בקצב המכירה הנוכחי',
        days: 'כמה ימים נשארו עד האזילה. החץ ← מציג את המספר אחרי שמחשיבים סחורה בדרך',
        confidence: 'עד כמה אפשר לסמוך על התחזית, לפי כמות היסטוריית המכירות: 95% = 3+ חודשי נתונים, 40% = רק שנה שעברה, 10% = כמעט אין נתונים. אחוז נמוך אומר שהתאריך ניחוש — לא שצריך להזמין יותר',
        urgency: 'דירוג לפי הימים שנשארו: קריטי מתחת ל-30, אזהרה 30-60, מעקב 60-90, אחרת תקין',
      }
    : {
        code: 'Catalog item number',
        name: 'Item name',
        stock: 'Units physically on the shelf right now',
        pipeline: 'Ordered from the supplier or in transit — not yet on the shelf',
        demand: 'Average units sold per month, estimated from sales history',
        date: 'Projected date stock reaches zero at the current sales rate',
        days: 'Days until that date. The → arrow shows the number once incoming units are counted',
        confidence: 'How much sales history backs the forecast: 95% = 3+ months of data, 40% = last year only, 10% = almost none. A low value means the date is a guess — not that you should order more',
        urgency: 'Bucket by days left: Critical under 30, Warning 30-60, Watch 60-90, otherwise OK',
      }

  return (
    <div className="space-y-6" dir={dir}>
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
          {he ? 'תחזית אזילת מלאי' : 'Stock-out Forecast'}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {he
            ? 'תחזית אזילת מלאי מבוססת החלקה מעריכית (שיטת הולט) על נתוני מכירות היסטוריים'
            : 'Predictive stock-out alerts based on Holt\'s exponential smoothing of historical sales data'}
        </p>
        {/* The two things people misread: "אמינות תחזית" is about data quality,
            not stock level; and the blue arrow/truck mean incoming units count. */}
        <p className="text-muted-foreground text-xs mt-2 leading-relaxed">
          {he
            ? 'טיפ: עבירו עם העכבר על כותרת עמודה להסבר. «אמינות תחזית» מודדת כמה היסטוריית מכירות עומדת מאחורי התחזית — אחוז נמוך אומר שתאריך האזילה הוא ניחוש, לא שצריך להזמין יותר. סימון כחול (← או משאית) אומר שהחישוב כולל סחורה שהוזמנה או בדרך.'
            : 'Tip: hover a column title for an explanation. "Reliability" measures how much sales history backs the forecast — a low value means the stock-out date is a guess, not that you should order more. Blue markers (→ or a truck) mean on-order/in-transit units are included.'}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
        <Card className={cn('border-red-200 dark:border-red-800')}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <ShieldAlert className="h-4 w-4 text-red-500" />
              <span className="text-xs text-muted-foreground">{he ? 'קריטי (<30 יום)' : 'Critical (<30 days)'}</span>
            </div>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {isLoading ? <Skeleton className="h-8 w-12" /> : <AnimatedCounter value={criticalCount} />}
            </div>
          </CardContent>
        </Card>

        <Card className={cn('border-amber-200 dark:border-amber-800')}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">{he ? 'אזהרה (30-60 יום)' : 'Warning (30-60 days)'}</span>
            </div>
            <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {isLoading ? <Skeleton className="h-8 w-12" /> : <AnimatedCounter value={warningCount} />}
            </div>
          </CardContent>
        </Card>

        <Card className={cn('border-blue-200 dark:border-blue-800')}>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <Eye className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">{he ? 'מעקב (60-90 יום)' : 'Watch (60-90 days)'}</span>
            </div>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {isLoading ? <Skeleton className="h-8 w-12" /> : <AnimatedCounter value={watchCount} />}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">{he ? 'ערך מלאי בסיכון' : 'Value at Risk'}</span>
            </div>
            <div className="text-2xl font-bold">
              {isLoading ? <Skeleton className="h-8 w-20" /> : ILS_FORMAT.format(totalValueAtRisk)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{he ? 'סנן לפי דחיפות:' : 'Filter by urgency:'}</span>
            </div>
            <div className="flex gap-1.5">
              {[
                { key: undefined, label: he ? 'הכל' : 'All' },
                { key: 'critical', label: he ? 'קריטי' : 'Critical' },
                { key: 'warning', label: he ? 'אזהרה' : 'Warning' },
                { key: 'watch', label: he ? 'מעקב' : 'Watch' },
                { key: 'critical,warning', label: he ? 'קריטי + אזהרה' : 'Critical + Warning' },
              ].map((f) => (
                <Button
                  key={f.key ?? 'all'}
                  variant={urgencyFilter === f.key ? 'default' : 'outline'}
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => setUrgencyFilter(f.key)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className={cn('absolute top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground', isRTL ? 'right-2.5' : 'left-2.5')} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={he ? 'חפש לפי קוד או שם...' : 'Search by code or name...'}
                  className={cn(
                    'w-full h-8 rounded-md border border-input bg-background text-sm px-8',
                    'focus:outline-none focus:ring-1 focus:ring-ring'
                  )}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className={cn('absolute top-1/2 -translate-y-1/2', isRTL ? 'left-2.5' : 'right-2.5')}
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{he ? 'שורות:' : 'Rows:'}</span>
              <select
                value={rowLimit}
                onChange={(e) => setRowLimit(Number(e.target.value))}
                className="h-8 rounded-md border border-input bg-background text-xs px-2 focus:outline-none focus:ring-1 focus:ring-ring"
                title={he
                  ? 'כמה פריטים לטעון. הכרטיסים למעלה תמיד סופרים את כל הפריטים'
                  : 'How many items to load. The cards above always count everything'}
              >
                {[200, 500, 1000, 2000].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-8 gap-1.5"
              onClick={exportToExcel}
              disabled={isLoading || isExporting || sortedItems.length === 0}
              title={he
                ? 'ייצוא כל הפריטים התואמים לסינון ולחיפוש — לא רק השורות המוצגות'
                : 'Exports every item matching the filter and search — not just the rows on screen'}
            >
              {isExporting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Download className="h-3.5 w-3.5" />}
              {he ? 'ייצוא לאקסל' : 'Export Excel'}
              {summary?.total ? <span className="text-muted-foreground">({summary.total})</span> : null}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error state */}
      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-4">
            <p className="text-destructive text-sm">{he ? 'שגיאה בטעינת נתוני תחזית' : 'Error loading forecast data'}</p>
          </CardContent>
        </Card>
      )}

      {/* Items Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {he ? 'פריטים לפי סיכון אזילה' : 'Items by Stock-out Risk'}
            {!isLoading && (
              <span className="text-sm font-normal text-muted-foreground ms-2">
                ({filteredItems.length} {he ? 'פריטים' : 'items'}
                {/* Say so when the row cap is hiding results, rather than
                    letting the list look complete. */}
                {summary && summary.total > items.length && (
                  <> {he ? `מתוך ${summary.total} — הגדל "שורות" כדי לראות עוד` : `of ${summary.total} — raise "Rows" to see more`}</>
                )})
                {/* Sorting/searching round-trips to the server now, so show
                    that something is happening while the old rows are still up. */}
                {isFetching && (
                  <Loader2 className="inline h-3 w-3 animate-spin ms-2 align-middle" />
                )}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {he ? 'לא נמצאו פריטים' : 'No items found'}
            </div>
          ) : (
            <div className="overflow-auto max-h-[calc(100vh-22rem)] -mx-3 sm:mx-0 px-3 sm:px-0">
              {/* Bounded height makes this the scroll container that `sticky` latches
                  onto: a plain overflow-x-auto wrapper computes overflow-y:auto but
                  never scrolls, so a sticky header inside it scrolls away with the page. */}
              <table className="w-full text-xs sm:text-sm min-w-[780px]">
                <thead className="sticky top-0 z-20 bg-card">
                  <tr className="border-b text-muted-foreground [&>th]:py-2">
                    <SortableTh<any> label={he ? 'קוד' : 'Code'} hint={hints.code} sortKey="item_code" align="end" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh<any> label={he ? 'שם' : 'Name'} hint={hints.name} sortKey="item_name" align="end" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh<any> label={he ? 'מלאי במחסן' : 'On Hand'} hint={hints.stock} sortKey="current_stock" align="center" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh<any> label={he ? 'הוזמן/בדרך' : 'On Order'} hint={hints.pipeline} sortKey="pipeline_qty" align="center" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh<any> label={he ? 'ביקוש חודשי' : 'Monthly Demand'} hint={hints.demand} sortKey="predicted_monthly_demand" align="center" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh<any> label={he ? 'תאריך אזילה' : 'Stock-out Date'} hint={hints.date} sortKey="stock_out_date" align="center" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh<any> label={he ? 'ימים עד אזילה' : 'Days Left'} hint={hints.days} sortKey="days_until_stockout" align="center" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh<any> label={he ? 'אמינות תחזית' : 'Reliability'} hint={hints.confidence} sortKey="confidence" align="center" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                    <SortableTh<any> label={he ? 'דחיפות' : 'Urgency'} hint={hints.urgency} sortKey="urgency" align="center" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {sortedItems.map((item: any) => (
                      <motion.tr
                        key={item.item_code}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className={cn(
                          'border-b hover:bg-muted/50 cursor-pointer transition-colors',
                          expandedItem === item.item_code && 'bg-muted/30'
                        )}
                        onClick={() => setExpandedItem(expandedItem === item.item_code ? null : item.item_code)}
                      >
                        <td className="py-2.5 font-mono text-xs text-end">
                          <div className="flex items-center gap-1.5">
                            <EbayRecommendButton itemCode={item.item_code} itemName={item.item_name} />
                            <ItemLink code={item.item_code} showCode />
                          </div>
                        </td>
                        <td className="py-2.5 max-w-[200px] truncate text-end" title={item.item_name}><ItemLink code={item.item_code} name={item.item_name || '-'} /></td>
                        <td className="py-2.5 text-center tabular-nums">{formatNumber(item.current_stock)}</td>
                        <td className="py-2.5 text-center tabular-nums">
                          {(item.pipeline_qty ?? 0) > 0 ? (
                            <span
                              className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400"
                              title={he
                                ? `הוזמן: ${formatNumber(item.ordered_qty ?? 0)} · בדרך: ${formatNumber(item.incoming_qty ?? 0)}`
                                : `Ordered: ${formatNumber(item.ordered_qty ?? 0)} · In transit: ${formatNumber(item.incoming_qty ?? 0)}`}
                            >
                              <Truck className="h-3.5 w-3.5" />
                              {formatNumber(item.pipeline_qty)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </td>
                        <td className="py-2.5 text-center tabular-nums">{formatNumber(item.predicted_monthly_demand)}</td>
                        <td className="py-2.5 text-center text-xs">{formatDate(item.stock_out_date, locale)}</td>
                        <td className="py-2.5 text-center tabular-nums">
                          {item.days_until_stockout != null ? (
                            <span className={cn(
                              item.days_until_stockout < 30 ? 'text-red-600 dark:text-red-400 font-semibold' :
                              item.days_until_stockout < 60 ? 'text-amber-600 dark:text-amber-400' :
                              'text-muted-foreground'
                            )}>
                              {item.days_until_stockout}
                              {item.days_with_pipeline != null && item.days_with_pipeline !== item.days_until_stockout && (
                                <span
                                  className="text-sky-600 dark:text-sky-400"
                                  title={he ? 'כולל הוזמן/בדרך' : 'Including on-order/in-transit'}
                                >
                                  {' '}→ {item.days_with_pipeline}
                                </span>
                              )}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="py-2.5 text-center text-xs text-muted-foreground">{Math.round((item.confidence || 0) * 100)}%</td>
                        <td className="py-2.5 text-center">
                          <span className="inline-flex items-center gap-1">
                            <UrgencyBadge urgency={item.urgency} locale={locale} />
                            {item.stock_urgency && item.stock_urgency !== item.urgency && (
                              <span title={he ? 'הדחיפות חושבה כולל הוזמן/בדרך' : 'Urgency includes on-order/in-transit'}>
                                <Truck className="h-3.5 w-3.5 text-sky-500" />
                              </span>
                            )}
                          </span>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          )}

          {/* Expanded forecast chart */}
          <AnimatePresence>
            {expandedItem && (
              <motion.div
                key={expandedItem}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 overflow-hidden"
              >
                <Card className="border-dashed">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">
                        {he ? 'תחזית מפורטת:' : 'Detailed Forecast:'} {expandedItem}
                      </CardTitle>
                      <Button variant="ghost" size="sm" onClick={() => setExpandedItem(null)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ForecastChart itemCode={expandedItem} />
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </div>
  )
}
