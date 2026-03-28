'use client'

import { useState, useMemo, useEffect, Suspense } from 'react'
import { useSeasonalData, useSeasonalItems } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { useUrlParams } from '@/hooks/use-url-params'
import { SeasonalHeatmap } from '@/components/charts/SeasonalHeatmap'
import { DateRangePicker } from '@/components/shared/DateRangePicker'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { MONTH_NAMES } from '@/lib/constants'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { Snowflake, Sun, Sparkles, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useQueryClient } from '@tanstack/react-query'

function SeasonalItemsSection({ dateFrom, dateTo }: { dateFrom: string; dateTo: string }) {
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiRequested, setAiRequested] = useState(false)
  const [historicalSyncing, setHistoricalSyncing] = useState(false)
  const [historicalProgress, setHistoricalProgress] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data, isLoading, isFetching } = useSeasonalItems(dateFrom, dateTo, aiEnabled)

  const winterItems = data?.winter_items || []
  const summerItems = data?.summer_items || []
  const aiInsights = data?.ai_insights || null
  const totalAnalyzed = data?.total_analyzed || 0
  const emptyReason = data?.empty_reason
  const isRelative = data?.is_relative
  const noSummerData = data?.no_summer_data

  const handleGenerateAI = () => {
    if (aiEnabled) {
      // Already enabled — refetch with cache bust
      queryClient.invalidateQueries({ queryKey: ['seasonal-items', dateFrom, dateTo, true] })
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
              <div className="overflow-auto max-h-[360px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                    <tr>
                      <th className="text-right px-3 py-2 font-medium">פריט</th>
                      <th className="text-center px-2 py-2 font-medium whitespace-nowrap">% חורף</th>
                      <th className="text-right px-3 py-2 font-medium">סה"כ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {winterItems.map((item: any, i: number) => (
                      <tr key={item.item_code} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                        <td className="px-3 py-2 max-w-[180px] truncate" title={item.item_name}>
                          {item.item_name}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <div
                              className="h-1.5 rounded-full bg-blue-500"
                              style={{ width: `${Math.round(item.winter_share * 40)}px` }}
                            />
                            <span className="text-blue-600 font-medium">
                              {Math.round(item.winter_share * 100)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          ₪{Math.round(item.total_revenue).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              <div className="overflow-auto max-h-[360px]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                    <tr>
                      <th className="text-right px-3 py-2 font-medium">פריט</th>
                      <th className="text-center px-2 py-2 font-medium whitespace-nowrap">% קיץ</th>
                      <th className="text-right px-3 py-2 font-medium">סה"כ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summerItems.map((item: any, i: number) => (
                      <tr key={item.item_code} className={i % 2 === 0 ? 'bg-background' : 'bg-muted/20'}>
                        <td className="px-3 py-2 max-w-[180px] truncate" title={item.item_name}>
                          {item.item_name}
                        </td>
                        <td className="px-2 py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <div
                              className="h-1.5 rounded-full bg-yellow-500"
                              style={{ width: `${Math.round(item.summer_share * 40)}px` }}
                            />
                            <span className="text-yellow-600 font-medium">
                              {Math.round(item.summer_share * 100)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-muted-foreground">
                          ₪{Math.round(item.total_revenue).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onChange={(from, to) => { setDateFrom(from); setDateTo(to) }}
        />
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
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="sales"
                    name={t('avgSales')}
                    stroke="hsl(var(--primary))"
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
    </div>
  )
}

export default function SeasonalPage() {
  return (
    <Suspense fallback={<Skeleton className="w-full h-[600px]" />}>
      <SeasonalPageContent />
    </Suspense>
  )
}
