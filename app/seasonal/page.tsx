'use client'

import { useState, useMemo, useEffect, Suspense } from 'react'
import { useSeasonalData, useSeasonalItems, useSeasonalItemsByMonth } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { useUrlParams } from '@/hooks/use-url-params'
import { SeasonalHeatmap } from '@/components/charts/SeasonalHeatmap'
import { DateRangePicker } from '@/components/shared/DateRangePicker'
import { DateRangePresets } from '@/components/shared/DateRangePresets'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SeasonalPageSkeleton } from '@/components/layout/PageSkeleton'
import { Badge } from '@/components/ui/badge'
import { ItemLink } from '@/components/shared/ItemLink'
import { MONTH_NAMES, formatCurrency } from '@/lib/constants'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { ChartGrid, AXIS_PROPS } from '@/components/charts/kit'
import { Snowflake, Sun, Sparkles, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useQueryClient } from '@tanstack/react-query'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'

function SeasonalItemsSection({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiRequested, setAiRequested] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const [historicalSyncing, setHistoricalSyncing] = useState(false)
  const [historicalProgress, setHistoricalProgress] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data, isLoading, isFetching } = useSeasonalItems(dateFrom, dateTo, aiEnabled, refreshTick)

  const winterItems = data?.winter_items || []
  const summerItems = data?.summer_items || []
  const aiInsights = data?.ai_insights || null
  const totalAnalyzed = data?.total_analyzed || 0
  const emptyReason = data?.empty_reason
  const isRelative = data?.is_relative
  const noSummerData = data?.no_summer_data

  const handleGenerateAI = () => {
    if (aiEnabled) {
      // Already enabled — bump the refresh tick to bypass the server cache and
      // regenerate (new query key → refetch with ?refresh=true).
      setRefreshTick((t) => t + 1)
    } else {
      setAiEnabled(true)
      setAiRequested(true)
    }
  }

  const isAiLoading = (aiEnabled || aiRequested) && (isLoading || isFetching) && !aiInsights

  const handleHistoricalSync = async () => {
    setHistoricalSyncing(true)
    try {
      const now = new Date()
      // Calculate how many months back dateFrom is from today
      const from = dateFrom ? new Date(dateFrom) : new Date(now.getFullYear() - 2, 0, 1)
      const totalPages = (now.getFullYear() - from.getFullYear()) * 12
        + (now.getMonth() - from.getMonth()) + 1

      for (let page = 1; page <= totalPages; page++) {
        const target = new Date(now.getFullYear(), now.getMonth() - (page - 1), 1)
        const label = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`
        setHistoricalProgress(`טוען ${label} (${page}/${totalPages})...`)
        await fetch(`/api/sync?mode=historical&page=${page}`)
      }
      queryClient.invalidateQueries({ queryKey: ['seasonal-items'] })
    } catch (e) {
      console.error('Historical sync failed:', e)
    } finally {
      setHistoricalSyncing(false)
      setHistoricalProgress(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Winter / Summer tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Winter Stars */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Snowflake className="w-4 h-4 text-blue-500" />
              מוצרי חורף מובילים
              {isRelative && (
                <Badge variant="outline" className="text-xs font-normal">
                  נטיות יחסיות בלבד
                </Badge>
              )}
              {noSummerData && !isRelative && (
                <Badge variant="outline" className="text-xs font-normal text-blue-500 border-blue-500/40">
                  נתוני חורף בלבד
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              פריטים עם נתח הכנסות גבוה יותר בחורף (נוב–אפר)
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : winterItems.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">
                {emptyReason === 'no_sync_data'
                  ? 'נדרש סנכרון נתונים לניתוח עונתי לפי פריט'
                  : 'אין נתוני פריטים עונתיים בטווח זה'}
              </p>
            ) : (
              <DataTable<SeasonalItem>
                rows={winterItems}
                columns={seasonColumns('winter')}
                getRowKey={i => i.item_code}
                defaultSort={{ field: 'share', dir: 'desc' }}
                maxHeight="360px"
                minWidth="min-w-[320px]"
                density="compact"
                exportFileName="פריטי-חורף"
              />
            )}
          </CardContent>
        </Card>

        {/* Summer Stars */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sun className="w-4 h-4 text-yellow-500" />
              מוצרי קיץ מובילים
              {isRelative && (
                <Badge variant="outline" className="text-xs font-normal">
                  נטיות יחסיות בלבד
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="text-xs">
              פריטים עם נתח הכנסות גבוה יותר בקיץ (מאי–אוק)
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : summerItems.length === 0 ? (
              <div className="p-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  {emptyReason === 'no_sync_data'
                    ? 'נדרש סנכרון נתונים לניתוח עונתי לפי פריט'
                    : noSummerData
                      ? 'אין נתוני מכירות קיץ — הסנכרון כלל חודשי חורף בלבד'
                      : 'אין נתוני פריטים עונתיים בטווח זה'}
                </p>
                {noSummerData && (
                  <button
                    onClick={handleHistoricalSync}
                    disabled={historicalSyncing}
                    className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md bg-yellow-500/10 text-yellow-500 border border-yellow-500/30 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
                  >
                    {historicalSyncing
                      ? <><Loader2 className="w-3 h-3 animate-spin" />{historicalProgress || 'טוען...'}</>
                      : '☀️ טעינת נתוני קיץ היסטוריים'}
                  </button>
                )}
              </div>
            ) : (
              <DataTable<SeasonalItem>
                rows={summerItems}
                columns={seasonColumns('summer')}
                getRowKey={i => i.item_code}
                defaultSort={{ field: 'share', dir: 'desc' }}
                maxHeight="360px"
                minWidth="min-w-[320px]"
                density="compact"
                exportFileName="פריטי-קיץ"
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Insights */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="w-4 h-4 text-purple-500" />
                ניתוח AI עונתי
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {totalAnalyzed > 0 ? `מבוסס על ${totalAnalyzed} פריטים עם נתוני מכירות` : 'לחץ לייצר ניתוח'}
              </CardDescription>
            </div>
            <button
              onClick={handleGenerateAI}
              disabled={isAiLoading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-60 transition-colors"
            >
              {isAiLoading ? (
                <><Loader2 className="w-3 h-3 animate-spin" /> מנתח...</>
              ) : (
                <><Sparkles className="w-3 h-3" /> {aiInsights ? 'רענן ניתוח' : 'ייצר ניתוח AI'}</>
              )}
            </button>
          </div>
        </CardHeader>
        {aiInsights && (
          <CardContent>
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed [&>ul]:space-y-1.5 [&>p]:mb-2">
              <ReactMarkdown>{aiInsights}</ReactMarkdown>
            </div>
          </CardContent>
        )}
        {!aiInsights && !isAiLoading && (
          <CardContent>
            <p className="text-sm text-muted-foreground text-center py-4">
              לחץ &quot;ייצר ניתוח AI&quot; לקבלת תובנות עונתיות מותאמות אישית
            </p>
          </CardContent>
        )}
        {isAiLoading && (
          <CardContent>
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              מנתח דפוסים עונתיים...
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  )
}

function PerMonthItemsSection({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { data, isLoading } = useSeasonalItemsByMonth(dateFrom, dateTo)
  const months: { month: number; items: any[] }[] = data?.months || []
  const hasAny = months.some((m) => m.items.length > 0)

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-1">
        פריטים חזקים לפי חודש
      </h2>
      <p className="text-xs text-muted-foreground mb-3">
        המוצרים המובילים בכל חודש (סכום מכירות על פני כל השנים בטווח)
      </p>
      {isLoading ? (
        <div className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : !hasAny ? (
        <p className="text-sm text-muted-foreground">אין נתוני מכירות חודשיים בטווח זה</p>
      ) : (
        // Single column below 480px — each month card holds a ~213px-min table
        // (150px name col + nowrap revenue) that overflows a 2-col grid on phones.
        <div className="grid grid-cols-1 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {months.map((m) => (
            <Card key={m.month}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{MONTH_NAMES[m.month - 1]}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {m.items.length === 0 ? (
                  <p className="px-3 pb-3 text-xs text-muted-foreground">—</p>
                ) : (
                  <table className="w-full text-xs">
                    <tbody>
                      {m.items.map((it, i) => (
                        <tr key={it.item_code} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                          <td className="px-3 py-1.5 max-w-[150px]">
                            <div className="truncate" title={it.item_name}>{it.item_name}</div>
                            <ItemLink code={it.item_code} showCode className="text-[10px]" />
                          </td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground whitespace-nowrap">
                            {formatCurrency(it.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function SeasonalPageContent() {
  const { t } = useLocale()
  const { get, setMany } = useUrlParams()
  const currentYear = new Date().getFullYear()
  const today = new Date().toISOString().split('T')[0]

  const [dateFrom, setDateFrom] = useState(get('date_from') || `${currentYear - 2}-01-01`)
  const [dateTo, setDateTo] = useState(get('date_to') || today)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(get('category'))
  const { data, isLoading } = useSeasonalData(dateFrom, dateTo)

  // Sync state to URL
  useEffect(() => {
    setMany({ date_from: dateFrom, date_to: dateTo, category: selectedCategory })
  }, [dateFrom, dateTo, selectedCategory, setMany])

  const seasonalData = data?.data || []

  const categories = useMemo(() => {
    const cats = [...new Set(seasonalData.map((d: any) => d.category as string))]
    return cats.sort() as string[]
  }, [seasonalData])

  const yoyData = selectedCategory
    ? MONTH_NAMES.map((month, i) => {
        const point = seasonalData.find((d: any) => d.category === selectedCategory && d.month === i + 1)
        return { month, sales: point?.avg_sales || 0 }
      })
    : []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <DateRangePresets
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={(from, to) => { setDateFrom(from); setDateTo(to) }}
          />
          <DateRangePicker
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={(from, to) => { setDateFrom(from); setDateTo(to) }}
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {categories.length} {t('items')}
        </span>
      </div>

      {categories.length > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap gap-1">
              {categories.map((cat: string) => (
                <Badge
                  key={cat}
                  variant={selectedCategory === cat ? 'default' : 'outline'}
                  className="cursor-pointer text-xs"
                  onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                >
                  {cat}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <SeasonalHeatmap data={seasonalData} isLoading={isLoading} />

      {selectedCategory && (
        <Card>
          <CardHeader>
            <CardTitle>{selectedCategory} - {t('monthlyTrend')}</CardTitle>
            <CardDescription>{t('salesIntensity')}</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="w-full h-[220px] sm:h-[280px] lg:h-[350px]" />
            ) : (
              <div className="h-[220px] sm:h-[280px] lg:h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={yoyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <ChartGrid />
                  <XAxis dataKey="month" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="sales"
                    name={t('avgSales')}
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Item-level seasonal analysis */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
          ניתוח עונתי לפי פריט
        </h2>
        <SeasonalItemsSection dateFrom={dateFrom} dateTo={dateTo} />
      </div>

      <PerMonthItemsSection dateFrom={dateFrom} dateTo={dateTo} />
    </div>
  )
}

/** A seasonally-skewed item, as the seasonal-items endpoint returns it. */
interface SeasonalItem {
  item_code: string
  item_name: string
  total_revenue: number
  winter_share?: number
  summer_share?: number
}

/**
 * The winter and summer lists are the same table with a different season, so
 * they share one column set rather than two near-identical copies that drift.
 */
function seasonColumns(season: 'winter' | 'summer'): DataTableColumn<SeasonalItem>[] {
  const share = (i: SeasonalItem) => (season === 'winter' ? i.winter_share : i.summer_share) ?? 0
  return [
    {
      key: 'item',
      header: 'פריט',
      sortable: true,
      sortValue: i => i.item_name || '',
      truncate: 'max-w-[180px]',
      title: i => i.item_name,
      cell: i => (
        <div>
          <div className="truncate">{i.item_name}</div>
          <ItemLink code={i.item_code} showCode className="text-[11px]" />
        </div>
      ),
      exportValue: i => i.item_name,
    },
    {
      key: 'share',
      header: season === 'winter' ? '% חורף' : '% קיץ',
      align: 'center',
      sortable: true,
      sortValue: share,
      cell: i => (
        <div className="flex items-center justify-center gap-1">
          <div
            className={`h-1.5 rounded-full ${season === 'winter' ? 'bg-blue-500' : 'bg-yellow-500'}`}
            style={{ width: `${Math.round(share(i) * 40)}px` }}
          />
          <span className={`font-medium ${season === 'winter' ? 'text-blue-600' : 'text-yellow-600'}`}>
            {Math.round(share(i) * 100)}%
          </span>
        </div>
      ),
      // The fraction, not the "63%" string — so the column stays averageable.
      exportValue: i => share(i),
    },
    {
      key: 'total_revenue',
      header: 'סה"כ',
      align: 'end',
      sortable: true,
      cell: i => <span className="text-muted-foreground">{formatCurrency(i.total_revenue)}</span>,
      exportValue: i => i.total_revenue,
    },
  ]
}

export default function SeasonalPage() {
  return (
    <Suspense fallback={<SeasonalPageSkeleton />}>
      <SeasonalPageContent />
    </Suspense>
  )
}
