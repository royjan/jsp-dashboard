'use client'

import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useGapAnalysis, useFollowUpStats } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { ItemLink } from '@/components/shared/ItemLink'
import { EbayRecommendButton } from '@/components/shared/EbayRecommendButton'
import {
  SearchX, Package, FileText, Search, ArrowUpDown,
  MessageCircle, TrendingUp, DollarSign, Send,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { NUMBER_FORMAT, formatNumber } from '@/lib/constants'

type SortField = 'name' | 'total_qty' | 'quote_count' | 'last_quoted' | 'stock_qty' | 'incoming_qty'
type SortDir = 'asc' | 'desc'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cardVariants: any = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.08, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-3" /><Skeleton className="h-8 w-24" /></CardContent></Card>
        ))}
      </div>
      <Card><CardContent className="p-6"><Skeleton className="w-full h-[300px]" /></CardContent></Card>
    </div>
  )
}

const ILS_FORMAT = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', minimumFractionDigits: 0, maximumFractionDigits: 0 })

function FollowUpWidget() {
  const { t } = useLocale()
  const { data, isLoading } = useFollowUpStats(3)

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <Skeleton className="h-4 w-32 mb-3" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-green-600" />
          {t('followUpStats')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Send className="h-3 w-3 text-blue-500" />
              {t('openForFollowUp')}
            </div>
            <div className="text-base sm:text-lg font-bold">{NUMBER_FORMAT.format(data.open_quotes ?? 0)}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3 text-green-500" />
              {t('convertedQuotes')}
            </div>
            <div className="text-lg font-bold">{NUMBER_FORMAT.format(data.converted_quotes ?? 0)}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <SearchX className="h-3 w-3 text-amber-500" />
              {t('followUpConversion')}
            </div>
            <div className="text-lg font-bold">{data.conversion_rate ?? 0}%</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <DollarSign className="h-3 w-3 text-red-500" />
              {t('openQuoteValue')}
            </div>
            <div className="text-lg font-bold">{ILS_FORMAT.format(data.open_value ?? 0)}</div>
          </div>
        </div>

        {/* Top open quotes table */}
        {data.top_open && data.top_open.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-medium text-muted-foreground mb-2">{t('topOpenQuotes')}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-start p-1.5">#</th>
                    <th className="text-start p-1.5">{t('customer')}</th>
                    <th className="text-end p-1.5">{t('amount')}</th>
                    <th className="text-end p-1.5">{t('date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_open.slice(0, 5).map((q: any) => (
                    <tr key={q.doc_number} className="border-b hover:bg-muted/50">
                      <td className="p-1.5 font-mono">{q.doc_number}</td>
                      <td className="p-1.5 truncate max-w-[200px]">{q.customer_name}</td>
                      <td className="p-1.5 text-end font-medium">{ILS_FORMAT.format(q.total)}</td>
                      <td className="p-1.5 text-end text-muted-foreground">{q.date || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function GapAnalysisPage() {
  const { t } = useLocale()
  const { data, isLoading, error } = useGapAnalysis('31', 200)
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('quote_count')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const items = useMemo(() => {
    if (!data?.items) return []
    let list = data.items.filter((item: any) =>
      !search || item.name?.toLowerCase().includes(search.toLowerCase()) || item.item_code?.toUpperCase().includes(search.toUpperCase())
    )
    list.sort((a: any, b: any) => {
      const aVal = a[sortField]
      const bVal = b[sortField]
      if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal
    })
    return list
  }, [data, search, sortField, sortDir])

  const topItems = items.slice(0, 15)

  if (isLoading) return <LoadingSkeleton />
  if (error) return <div className="text-destructive p-4">Error: {(error as Error).message}</div>

  return (
    <div className="space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold">{t('page.gap')}</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        {[
          { label: t('gapItems'), value: NUMBER_FORMAT.format(data?.count ?? 0), icon: SearchX, color: 'text-red-600' },
          { label: t('lostQty'), value: NUMBER_FORMAT.format(data?.total_lost_qty ?? 0), icon: Package, color: 'text-orange-600' },
          { label: t('totalQuoted'), value: NUMBER_FORMAT.format(data?.total_quoted_items ?? 0), icon: FileText, color: 'text-blue-600' },
          { label: t('conversionRate'), value: data?.total_quoted_items ? `${Math.round(((data.total_quoted_items - (data.count ?? 0)) / data.total_quoted_items) * 100)}%` : '-', icon: SearchX, color: 'text-green-600' },
        ].map((kpi, i) => (
          <motion.div key={kpi.label} custom={i} variants={cardVariants} initial="hidden" animate="visible">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <kpi.icon className={cn('h-3.5 w-3.5', kpi.color)} />
                  {kpi.label}
                </div>
                <div className="text-lg font-bold">{kpi.value}</div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Follow-up Stats Widget */}
      <FollowUpWidget />

      {/* Top items by times quoted */}
      <Card>
        <CardHeader><CardTitle className="text-base">{t('demandFrequency')} — Top 15</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topItems} layout="vertical" margin={{ left: 0, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="item_code" width={80} tick={{ fontSize: 10 }} />
              <Tooltip
                labelFormatter={(code) => {
                  const item = topItems.find((i: any) => i.item_code === code)
                  return item ? `${code} — ${item.name}` : code
                }}
              />
              <Bar dataKey="quote_count" fill="#ef4444" name={t('quotesCount')} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Items Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-base">{t('quotedNotInStock')} ({items.length})</CardTitle>
            <div className="relative">
              <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="ps-8 h-9 rounded-md border bg-background px-3 text-sm w-full sm:w-64"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
            <table className="w-full text-xs sm:text-sm min-w-[650px]">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-start p-2">{t('code')}</th>
                  <th className="text-start p-2 cursor-pointer" onClick={() => toggleSort('name')}>
                    <span className="flex items-center gap-1">{t('item')} <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-end p-2 cursor-pointer" onClick={() => toggleSort('quote_count')}>
                    <span className="flex items-center justify-end gap-1">{t('quotesCount')} <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-end p-2 cursor-pointer" onClick={() => toggleSort('total_qty')}>
                    <span className="flex items-center justify-end gap-1">{t('quantity')} <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-end p-2 cursor-pointer" onClick={() => toggleSort('last_quoted')}>
                    <span className="flex items-center justify-end gap-1">{t('lastQuoted')} <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-end p-2 cursor-pointer" onClick={() => toggleSort('stock_qty')}>
                    <span className="flex items-center justify-end gap-1">{t('stockQty')} <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-end p-2 cursor-pointer" onClick={() => toggleSort('incoming_qty')}>
                    <span className="flex items-center justify-end gap-1">{t('incoming')} <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item: any, i: number) => (
                  <motion.tr
                    key={item.item_code}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.015, 0.5), duration: 0.2 }}
                    className="border-b hover:bg-muted/50 transition-colors"
                  >
                    <td className="p-2 font-mono text-xs">
                      <div className="flex items-center gap-1.5">
                        <EbayRecommendButton itemCode={item.item_code} itemName={item.name} />
                        <ItemLink code={item.item_code} showCode />
                      </div>
                    </td>
                    <td className="p-2"><ItemLink code={item.item_code} name={item.name} /></td>
                    <td className="p-2 text-end font-medium">{formatNumber(item.quote_count)}</td>
                    <td className="p-2 text-end">{NUMBER_FORMAT.format(item.total_qty)}</td>
                    <td className="p-2 text-end text-muted-foreground">{item.last_quoted || '-'}</td>
                    <td className="p-2 text-end">
                      <Badge variant="destructive">0</Badge>
                    </td>
                    <td className="p-2 text-end">
                      {item.incoming_qty > 0
                        ? <Badge variant="secondary">{formatNumber(item.incoming_qty)}</Badge>
                        : <span className="text-muted-foreground">0</span>
                      }
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
