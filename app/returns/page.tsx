'use client'

import { Suspense } from 'react'
import { motion } from 'framer-motion'
import { useReturnsAnalysis } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { CustomerLink } from '@/components/shared/CustomerLink'
import {
  RotateCcw, AlertTriangle, Users, TrendingDown, Receipt,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line,
} from 'recharts'
import { ChartGrid, AXIS_PROPS, BAR_RADIUS, BAR_MAX, ACTIVE_BAR } from '@/components/charts/kit'
import { formatCurrency, formatNumber } from '@/lib/format'
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

interface ReturnCustomer {
  code: string
  name: string
  total: number
  count: number
}

const RETURN_COLUMNS = (isHe: boolean): DataTableColumn<ReturnCustomer>[] => [
  {
    key: 'name',
    header: isHe ? 'לקוח' : 'Customer',
    sortable: true,
    cell: c => (
      <div className="min-w-0">
        <CustomerLink code={c.code} name={c.name} className="block truncate max-w-[200px] text-sm font-medium" />
        <div className="font-mono text-xs text-muted-foreground">{c.code}</div>
      </div>
    ),
    exportValue: c => c.name,
  },
  {
    key: 'total',
    header: isHe ? 'סכום זיכויים' : 'Credit Value',
    align: 'end',
    sortable: true,
    cell: c => formatCurrency(Math.round(c.total || 0)),
    exportValue: c => Math.round(c.total || 0),
    cellClassName: 'font-mono font-medium',
  },
  {
    key: 'count',
    header: isHe ? 'החזרות' : 'Returns',
    align: 'end',
    sortable: true,
    // Ten or more returns is the threshold this page treats as a problem.
    cell: c => (
      <Badge variant={c.count >= 10 ? 'destructive' : 'secondary'} className="text-xs">
        {c.count}x
      </Badge>
    ),
    exportValue: c => c.count,
  },
]

export default function ReturnsPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <ReturnsContent />
    </Suspense>
  )
}

function ReturnsContent() {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { locale } = useLocale()
  const isHe = locale === 'he'
  const { data, isLoading, error } = useReturnsAnalysis()

  if (isLoading) return <LoadingSkeleton />
  if (error) return <div className="text-red-500 p-4">Error loading returns data</div>
  if (!data) return null

  const kpis = data.kpis || {}
  const customers = data.top_returning_customers || []
  const monthly = data.monthly_trend || []

  const returnRateColor = kpis.return_rate > 10 ? 'text-red-500' : kpis.return_rate > 5 ? 'text-amber-500' : 'text-green-500'

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        <motion.div custom={0} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <RotateCcw className="h-3.5 w-3.5 text-red-500" />
                {isHe ? 'זיכויים' : 'Credit Notes'}
              </div>
              <div className="text-xl sm:text-2xl font-bold">{formatNumber(kpis.total_credits || 0)}</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={1} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                {isHe ? 'אחוז החזרות' : 'Return Rate'}
              </div>
              <div className={`text-xl sm:text-2xl font-bold ${returnRateColor}`}>{kpis.return_rate || 0}%</div>
              <div className="text-xs text-muted-foreground">
                {formatNumber(kpis.total_credits || 0)} / {formatNumber(kpis.total_invoices || 0)}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={2} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <Receipt className="h-3.5 w-3.5 text-blue-500" />
                {isHe ? 'חשבוניות' : 'Invoices'}
              </div>
              <div className="text-xl sm:text-2xl font-bold">{formatNumber(kpis.total_invoices || 0)}</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={3} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                {isHe ? 'נותחו' : 'Analyzed'}
              </div>
              <div className="text-xl sm:text-2xl font-bold">{formatNumber(data.credit_notes_analyzed || 0)}</div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
        {/* Top Returning Customers */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-red-500" />
              {isHe ? 'לקוחות עם הכי הרבה החזרות' : 'Top Returning Customers'}
              <Badge variant="secondary" className="text-xs">{customers.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Was customers.slice(0, 20) — twenty rows shown with nothing on
                screen to say the list was cut. maxRows keeps the cap (these rows
                are not virtualised) but states it and offers the rest. */}
            <DataTable
              rows={customers as ReturnCustomer[]}
              columns={RETURN_COLUMNS(isHe)}
              getRowKey={(c, i) => c.code || String(i)}
              defaultSort={{ field: 'total', dir: 'desc' }}
              maxRows={20}
              minWidth="min-w-[420px]"
              exportFileName={isHe ? 'לקוחות-עם-החזרות' : 'returning-customers'}
              labels={{ empty: isHe ? 'אין נתוני זיכויים' : 'No credit note data' }}
              mobileCard={{
                title: c => c.name || c.code,
                subtitle: c => c.code,
                accent: c => formatCurrency(Math.round(c.total || 0)),
                fields: [{ label: isHe ? 'החזרות' : 'Returns', value: c => `${c.count}x` }],
              }}
            />
          </CardContent>
        </Card>

        {/* Monthly Trend */}
        {monthly.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-amber-500" />
                {isHe ? 'מגמת החזרות חודשית' : 'Monthly Return Trend'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthly}>
                  <ChartGrid />
                  <XAxis dataKey="month" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} />
                  <Tooltip />
                  <Bar activeBar={ACTIVE_BAR} dataKey="count" fill="#ef4444" radius={BAR_RADIUS.vertical} maxBarSize={BAR_MAX} name={isHe ? 'החזרות' : 'Returns'} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
