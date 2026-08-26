'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useDemandOverview } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Search, AlertTriangle, TrendingUp, Users, Clock, ArrowUpRight,
  MessageCircle, Package,
} from 'lucide-react'
import { ItemLink } from '@/components/shared/ItemLink'
import { SubTabs } from '@/components/shared/SubTabs'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import { ChartGrid, AXIS_PROPS, BAR_RADIUS, BAR_MAX, ACTIVE_BAR } from '@/components/charts/kit'
import { formatNumber, formatCurrency } from '@/lib/format'
import { cardVariants } from '@/lib/motion'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'


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

interface DemandRow {
  code: string
  name: string
  request_count: number
  total_qty_requested: number
  stock_qty: number
  price: number
}

const DEMAND_COLUMNS: DataTableColumn<DemandRow>[] = [
  { key: 'code', header: 'Code', sortable: true,
    cell: r => <ItemLink code={r.code} showCode />, exportValue: r => r.code,
    cellClassName: 'font-mono text-xs' },
  { key: 'name', header: 'Name', sortable: true, truncate: 'max-w-[200px]',
    title: r => r.name,
    cell: r => <span dir="rtl"><ItemLink code={r.code} name={r.name} /></span>,
    exportValue: r => r.name },
  { key: 'request_count', header: 'Quotes', align: 'end', sortable: true,
    cell: r => formatNumber(r.request_count), exportValue: r => r.request_count },
  { key: 'total_qty_requested', header: 'Qty', align: 'end', sortable: true,
    cell: r => formatNumber(r.total_qty_requested), exportValue: r => r.total_qty_requested },
  { key: 'stock_qty', header: 'Stock', align: 'end', sortable: true,
    // Nothing in stock is the point of a demand table, so it stays red.
    cell: r => (
      <span className={r.stock_qty === 0 ? 'font-medium text-red-500' : undefined}>
        {formatNumber(r.stock_qty)}
      </span>
    ),
    exportValue: r => r.stock_qty },
  { key: 'price', header: 'Price', align: 'end', sortable: true,
    cell: r => (r.price > 0 ? formatCurrency(r.price) : '-'),
    exportValue: r => (r.price > 0 ? r.price : null) },
]

export default function DemandPage() {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { t } = useLocale()
  const [days, setDays] = useState(30)
  const { data, isLoading, error } = useDemandOverview(days)

  if (isLoading) return <LoadingSkeleton />
  if (error) return <div className="text-red-500 p-4">Error loading demand data</div>
  if (!data) return null

  const metrics = data.search_metrics || {}
  const topSearched = data.top_searched || []
  const zeroResults = data.zero_results || []
  const trending = data.trending || []
  const erpDemand = data.erp_demand?.items || []

  return (
    <div className="space-y-6">
      <SubTabs
        tabs={[
          { href: '/stock', label: t('stock') },
          { href: '/stock/demand', label: t('demand') },
        ]}
      />
      {/* Period selector */}
      <div className="flex gap-1.5 sm:gap-2">
        {[7, 14, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors min-h-[36px] ${
              days === d
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {d}d
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        <motion.div custom={0} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <Search className="h-3.5 w-3.5 text-blue-500" />
                {t('chatSearches')}
              </div>
              <div className="text-xl sm:text-2xl font-bold">{formatNumber(metrics.total_searches || 0)}</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={1} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                {t('zeroResultRate')}
              </div>
              <div className="text-xl sm:text-2xl font-bold">{metrics.zero_result_rate || 0}%</div>
              <div className="text-xs text-muted-foreground">
                {formatNumber(metrics.zero_result_count || 0)} failed
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={2} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <Clock className="h-3.5 w-3.5 text-violet-500" />
                {t('avgResponseTime')}
              </div>
              <div className="text-xl sm:text-2xl font-bold">{formatNumber(metrics.avg_response_ms || 0)}ms</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={3} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <Users className="h-3.5 w-3.5 text-green-500" />
                {t('uniqueSearchUsers')}
              </div>
              <div className="text-xl sm:text-2xl font-bold">{formatNumber(metrics.unique_users || 0)}</div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Two columns: Unmet Demand + Top Searched */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {/* Unmet Demand (zero-result searches) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              {t('unmetDemand')}
              <Badge variant="secondary" className="text-xs">{zeroResults.length}</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">{t('unmetDemandDesc')}</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {zeroResults.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No unmet demand found</p>
              ) : (
                zeroResults.map((item: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate" dir="auto">{item.query}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.unique_users} {item.unique_users === 1 ? 'user' : 'users'}
                      </div>
                    </div>
                    <Badge variant="destructive" className="shrink-0 text-xs">
                      {item.search_count}x
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Top Searched Items */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4 text-blue-500" />
              {t('topSearchedItems')}
              <Badge variant="secondary" className="text-xs">{topSearched.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {topSearched.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No search data yet</p>
              ) : (
                topSearched.slice(0, 20).map((item: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate" dir="auto">{item.query}</div>
                      <div className="text-xs text-muted-foreground flex gap-2">
                        <span>{item.unique_users} users</span>
                        {item.zero_result_count > 0 && (
                          <span className="text-amber-500">{item.zero_result_count} failed</span>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {item.search_count}x
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trending + Top Searched Chart */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {/* Trending Searches */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              {t('trendingSearches')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {trending.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No trending data</p>
              ) : (
                trending.map((item: any, i: number) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 py-2 px-3 rounded-lg bg-muted/50"
                  >
                    <div className="text-sm font-medium truncate flex-1" dir="auto">{item.query}</div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground">{item.recent_count}x</span>
                      <Badge className="text-xs bg-green-500/15 text-green-600 hover:bg-green-500/20">
                        <ArrowUpRight className="h-3 w-3 me-0.5" />
                        {item.growth_pct > 100 ? 'New' : `+${item.growth_pct}%`}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Top Searched Bar Chart */}
        {topSearched.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-blue-500" />
                {t('searchCount')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={topSearched.slice(0, 10).map((item: any) => ({
                    name: item.query.length > 15 ? item.query.slice(0, 15) + '...' : item.query,
                    searches: item.search_count,
                    failed: item.zero_result_count,
                  }))}
                  layout="vertical"
                  margin={{ left: 10, right: 10 }}
                >
                  <ChartGrid vertical horizontal={false} />
                  <XAxis type="number" {...AXIS_PROPS} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={120} {...AXIS_PROPS} />
                  <Tooltip />
                  <Bar activeBar={ACTIVE_BAR} dataKey="searches" fill="#3b82f6" radius={BAR_RADIUS.horizontal} maxBarSize={BAR_MAX} name="Searches" />
                  <Bar activeBar={ACTIVE_BAR} dataKey="failed" fill="#f59e0b" radius={BAR_RADIUS.horizontal} maxBarSize={BAR_MAX} name="Zero Results" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {/* ERP Quote Demand */}
      {erpDemand.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4 text-violet-500" />
              {t('erpQuoteDemand')}
              <Badge variant="secondary" className="text-xs">{erpDemand.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Was erpDemand.slice(0, 30): thirty rows with nothing saying the
                list was cut. The cap is stated now, and the rest is one click. */}
            <DataTable
              rows={erpDemand as DemandRow[]}
              columns={DEMAND_COLUMNS}
              getRowKey={r => r.code}
              defaultSort={{ field: 'request_count', dir: 'desc' }}
              maxRows={30}
              minWidth="min-w-[500px]"
              exportFileName="ביקוש-מהצעות-מחיר"
              mobileCard={{
                title: r => r.name,
                subtitle: r => r.code,
                accent: r => formatNumber(r.request_count),
                fields: [
                  { label: 'Qty', value: r => formatNumber(r.total_qty_requested) },
                  { label: 'Stock', value: r => formatNumber(r.stock_qty) },
                ],
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
