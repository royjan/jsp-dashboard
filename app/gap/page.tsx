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
import { SubTabs } from '@/components/shared/SubTabs'
import { EbayRecommendButton } from '@/components/shared/EbayRecommendButton'
import {
  SearchX, Package, FileText, Search,
  MessageCircle, TrendingUp, DollarSign, Send,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import { ChartGrid, AXIS_PROPS, BAR_RADIUS } from '@/components/charts/kit'
import { formatCurrency, formatNumber, formatDate } from '@/lib/format'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { sortRows } from '@/lib/sort'
import { cardVariants } from '@/lib/motion'
import { useMoneyHidden } from '@/lib/use-money-hidden'

type SortField = 'name' | 'total_qty' | 'quote_count' | 'last_quoted' | 'stock_qty' | 'incoming_qty' | 'ordered_qty'
type SortDir = 'asc' | 'desc'


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


function FollowUpWidget() {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

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
            <div className="text-base sm:text-lg font-bold">{formatNumber(data.open_quotes ?? 0)}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3 text-green-500" />
              {t('convertedQuotes')}
            </div>
            <div className="text-lg font-bold">{formatNumber(data.converted_quotes ?? 0)}</div>
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
            <div className="text-lg font-bold">{formatCurrency(data.open_value ?? 0)}</div>
          </div>
        </div>

        {/* Top open quotes table */}
        {data.top_open && data.top_open.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-medium text-muted-foreground mb-2">{t('topOpenQuotes')}</div>
            <DataTable
              rows={data.top_open.slice(0, 5)}
              columns={TOP_OPEN_COLUMNS(t)}
              getRowKey={(q: any) => q.doc_number}
              minWidth="min-w-0"
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** The translator, with its full key union preserved. */
type Translate = ReturnType<typeof useLocale>['t']

/* eslint-disable @typescript-eslint/no-explicit-any */
const TOP_OPEN_COLUMNS = (t: Translate): DataTableColumn<any>[] => [
  { key: 'doc_number', header: '#', cellClassName: 'font-mono', cell: (q: any) => q.doc_number },
  { key: 'customer_name', header: t('customer'), truncate: 'max-w-[200px]', title: (q: any) => q.customer_name, cell: (q: any) => q.customer_name },
  { key: 'total', header: t('amount'), align: 'end', cellClassName: 'font-medium', cell: (q: any) => formatCurrency(q.total) },
  { key: 'date', header: t('date'), align: 'end', cellClassName: 'text-muted-foreground', cell: (q: any) => formatDate(q.date) },
]

const GAP_COLUMNS = (t: Translate): DataTableColumn<any, SortField>[] => [
  {
    key: 'item_code', header: t('code'), cellClassName: 'font-mono text-xs',
    cell: (item: any) => (
      <div className="flex items-center gap-1.5">
        <EbayRecommendButton itemCode={item.item_code} itemName={item.name} />
        <ItemLink code={item.item_code} showCode />
      </div>
    ),
  },
  {
    key: 'name', header: t('item'), sortable: true,
    // A gap row with an aftermarket substitute on the shelf is a different
    // decision from one with nothing behind it — the page used to show them
    // identically. Still counted as a gap: a חליפי is a different SKU at a
    // different price and the customer may refuse it.
    cell: (item: any) => (
      <div className="flex items-center gap-1.5">
        <ItemLink code={item.item_code} name={item.name} />
        {(item.variants_in_stock?.length ?? 0) > 0 && (() => {
          // Only a חליפי can actually fill the order. The other suffixed codes
          // (9812071480S is a valve FOR the cover, ...D a diaphragm) are related
          // parts, and badging their 92 units as substitutes would tell the
          // buyer they hold 115 covers when they hold 23.
          const subs = item.variants_in_stock.filter((v: any) => v.is_substitute)
          const qty = (subs.length ? subs : item.variants_in_stock)
            .reduce((s: number, v: any) => s + (v.stock_qty || 0), 0)
          return (
            <span
              className={`shrink-0 rounded px-1 text-[10px] leading-4 ${
                subs.length
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                  : 'bg-muted text-muted-foreground'
              }`}
              title={item.variants_in_stock
                .map((v: any) => `${v.code} — ${v.name} (${v.stock_qty})${v.is_substitute ? ' ✓' : ''}`)
                .join('\n')}
            >
              {qty} {subs.length ? 'חליפי' : 'קרוב'}
            </span>
          )
        })()}
      </div>
    ),
  },
  { key: 'quote_count', header: t('quotesCount'), align: 'end', sortable: true, cellClassName: 'font-medium', cell: (i: any) => formatNumber(i.quote_count) },
  { key: 'total_qty', header: t('quantity'), align: 'end', sortable: true, cell: (i: any) => formatNumber(i.total_qty) },
  { key: 'last_quoted', header: t('lastQuoted'), align: 'end', sortable: true, cellClassName: 'text-muted-foreground', cell: (i: any) => formatDate(i.last_quoted) },
  {
    key: 'stock_qty', header: t('stockQty'), align: 'end', sortable: true,
    // Every row on this page is out of stock by definition — that is what a gap IS.
    cell: () => <Badge variant="destructive">0</Badge>,
  },
  {
    key: 'incoming_qty', header: t('incoming'), align: 'end', sortable: true,
    cell: (i: any) => i.incoming_qty > 0
      ? <Badge variant="secondary">{formatNumber(i.incoming_qty)}</Badge>
      : <span className="text-muted-foreground">0</span>,
  },
  {
    key: 'ordered_qty', header: t('orderedQty'), align: 'end', sortable: true,
    cell: (i: any) => i.ordered_qty > 0
      ? <Badge variant="outline">{formatNumber(i.ordered_qty)}</Badge>
      : <span className="text-muted-foreground">0</span>,
  },
]
/* eslint-enable @typescript-eslint/no-explicit-any */

export default function GapAnalysisPage() {
  const { t } = useLocale()
  const { data, isLoading, error } = useGapAnalysis('31', 200)
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('quote_count')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const items = useMemo(() => {
    if (!data?.items) return []
    const list = data.items.filter((item: any) =>
      !search || item.name?.toLowerCase().includes(search.toLowerCase()) || item.item_code?.toUpperCase().includes(search.toUpperCase())
    )
    // Shared comparator: Hebrew-aware, ISO dates chronological, blanks last.
    return sortRows(list, (row: any) => row[sortField], sortDir)
  }, [data, search, sortField, sortDir])

  const gapColumns = useMemo(() => GAP_COLUMNS(t), [t])

  const topItems = items.slice(0, 15)

  if (isLoading) return <LoadingSkeleton />
  if (error) return <div className="text-destructive p-4">Error: {(error as Error).message}</div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">{t('page.gap')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('gapSubtitle')}</p>
      </div>

      {/* Two different gaps share this entry: what customers asked for and we
          couldn't supply (here), and what sits on their cars and we can't sell
          at all (/gap/catalog). */}
      <SubTabs
        tabs={[
          { href: '/gap', label: t('catalogGap.tabDemand') },
          { href: '/gap/catalog', label: t('catalogGap.tabCatalog') },
        ]}
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        {[
          { label: t('gapItems'), value: formatNumber(data?.count ?? 0), icon: SearchX, color: 'text-red-600' },
          { label: t('lostQty'), value: formatNumber(data?.total_lost_qty ?? 0), icon: Package, color: 'text-orange-600' },
          { label: t('totalQuoted'), value: formatNumber(data?.total_quoted_items ?? 0), icon: FileText, color: 'text-blue-600' },
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
              <ChartGrid />
              <XAxis type="number" {...AXIS_PROPS} />
              <YAxis type="category" dataKey="item_code" width={80} {...AXIS_PROPS} />
              <Tooltip
                labelFormatter={(code) => {
                  const item = topItems.find((i: any) => i.item_code === code)
                  return item ? `${code} — ${item.name}` : code
                }}
              />
              <Bar dataKey="quote_count" fill="#ef4444" name={t('quotesCount')} radius={BAR_RADIUS.horizontal} />
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
          <DataTable
            rows={items}
            columns={gapColumns}
            getRowKey={(item: any) => item.item_code}
            sort={{ field: sortField, dir: sortDir }}
            onSortChange={({ field, dir }) => { setSortField(field); setSortDir(dir) }}
            minWidth="min-w-[650px]"
            maxHeight="70vh"
          />
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground/70 max-w-3xl">{t('gapMethodology')}</p>
    </div>
  )
}
