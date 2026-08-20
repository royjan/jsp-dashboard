'use client'

import { Suspense, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useMargin } from '@/hooks/use-margin'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemLink } from '@/components/shared/ItemLink'
import { formatNumber, formatCurrency, formatCurrencyAxis } from '@/lib/constants'
import {
  ScatterChart, Scatter, BarChart, Bar, XAxis, YAxis, ZAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  TrendingUp, Package, Percent, Hourglass, BarChart3, AlertTriangle,
} from 'lucide-react'
import { useMoneyHidden } from '@/lib/use-money-hidden'

const CHART_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']

function MarginContent() {
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { locale } = useLocale()
  const isHe = locale === 'he'
  const { data, isLoading, isError } = useMargin()

  const scatterData = useMemo(() => {
    if (!data?.byItem) return []
    return data.byItem.map((i) => ({
      x: i.revenue,
      y: i.quantity,
      z: i.avg_price,
      name: i.item_name || i.item_code,
      code: i.item_code,
    }))
  }, [data])

  // Quadrant reference: high revenue / low quantity = high-value SKUs;
  // low revenue / high quantity = low-value churn.
  const revMedian = useMemo(() => {
    if (!scatterData.length) return 0
    const sorted = [...scatterData].map((d) => d.x).sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }, [scatterData])


  // ── Loading ──
  if (isLoading) {
    return (
      <div className="space-y-4 md:space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-2" /><Skeleton className="h-8 w-24" /></CardContent></Card>
          ))}
        </div>
        <Card><CardContent className="p-4"><Skeleton className="h-[350px] w-full" /></CardContent></Card>
        <Card><CardContent className="p-4"><Skeleton className="h-[300px] w-full" /></CardContent></Card>
        <Card><CardContent className="p-4"><Skeleton className="h-[400px] w-full" /></CardContent></Card>
      </div>
    )
  }

  // ── Error / empty ──
  if (isError || data?.error || !data || data.byItem.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <AlertTriangle className="h-16 w-16 mx-auto mb-4 text-muted-foreground/30" />
          <p className="text-lg font-medium mb-2">
            {isHe ? 'אין נתוני מרווח להצגה' : 'No margin data to show'}
          </p>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {data?.error
              ? (isHe ? `שגיאה: ${data.error}` : `Error: ${data.error}`)
              : (isHe ? 'לא נמצאו מכירות. נסה שוב מאוחר יותר.' : 'No sales found. Try again later.')}
          </p>
        </CardContent>
      </Card>
    )
  }

  const s = data.summary
  const costPending = !data.cost_available || s.est_gross_margin_pct == null

  const kpis = [
    {
      icon: TrendingUp,
      label: isHe ? 'סה"כ הכנסה' : 'Total Revenue',
      value: formatCurrency(s.total_revenue),
      color: 'text-primary',
    },
    {
      icon: Package,
      label: isHe ? 'סה"כ כמות' : 'Total Quantity',
      value: formatNumber(s.total_quantity),
      sub: `${formatNumber(s.items_evaluated)} ${isHe ? 'פריטים' : 'items'}`,
      color: 'text-sky-500',
    },
    {
      icon: costPending ? Hourglass : Percent,
      label: isHe ? 'מרווח גולמי משוער' : 'Est. Gross Margin',
      value: costPending
        ? (isHe ? 'בהמתנה' : 'Pending')
        : `${formatNumber(s.est_gross_margin_pct, 1)}%`,
      sub: costPending ? (isHe ? 'עלות בהמתנה (FINAPI)' : 'cost pending (FINAPI)') : undefined,
      color: costPending ? 'text-amber-500' : 'text-emerald-500',
    },
    {
      icon: BarChart3,
      label: isHe ? 'קטגוריות' : 'Categories',
      value: formatNumber(data.byCategory.length),
      color: 'text-violet-500',
    },
  ]

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Cost-pending notice */}
      {costPending && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <Hourglass className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
          <p className="text-amber-700 dark:text-amber-300">
            {isHe ? (data.note_he || 'מרווח גולמי בהמתנה — מחיר עלות נמצא ב-FINAPI ועדיין לא מחובר.')
                  : (data.note_en || 'Gross margin pending — cost price lives in FINAPI and is not wired yet.')}
          </p>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        {kpis.map((kpi, i) => (
          <motion.div key={kpi.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className="overflow-hidden h-full">
              <CardContent className="p-3 md:p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
                  <kpi.icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{kpi.label}</span>
                </div>
                <div className={`text-lg md:text-2xl font-bold tabular-nums ${kpi.color}`}>{kpi.value}</div>
                {kpi.sub && <div className="text-[11px] text-muted-foreground mt-1">{kpi.sub}</div>}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Revenue vs Quantity scatter — spot high-revenue / low-value SKUs */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {isHe ? 'הכנסה מול כמות (איתור פריטים)' : 'Revenue vs Quantity (SKU map)'}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {isHe ? 'ימין-למטה = הכנסה גבוהה בכמות נמוכה (פריטי ערך). שמאל-למעלה = כמות גבוהה בהכנסה נמוכה.'
                  : 'High revenue / low quantity (right-bottom) = high-value SKUs. High quantity / low revenue = low-value churn.'}
          </p>
        </CardHeader>
        <CardContent>
          <div className="h-[350px] min-w-0">
            <ResponsiveContainer width="100%" height="100%" minHeight={120}>
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  type="number" dataKey="x" name={isHe ? 'הכנסה' : 'Revenue'}
                  tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrencyAxis(v)}
                />
                <YAxis
                  type="number" dataKey="y" name={isHe ? 'כמות' : 'Quantity'}
                  tick={{ fontSize: 11 }} tickFormatter={(v) => formatNumber(v)}
                />
                <ZAxis type="number" dataKey="z" range={[40, 400]} name={isHe ? 'מחיר' : 'Price'} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const p: any = payload[0].payload
                    return (
                      <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-md">
                        <div className="font-medium mb-1 max-w-[200px] truncate">{p.name}</div>
                        <div>{isHe ? 'הכנסה' : 'Revenue'}: {formatCurrency(p.x)}</div>
                        <div>{isHe ? 'כמות' : 'Quantity'}: {formatNumber(p.y)}</div>
                        <div>{isHe ? 'מחיר ממוצע' : 'Avg price'}: {formatCurrency(p.z)}</div>
                      </div>
                    )
                  }}
                />
                <Scatter data={scatterData}>
                  {scatterData.map((d, i) => (
                    <Cell key={i} fill={d.x >= revMedian ? '#10b981' : '#6366f1'} fillOpacity={0.6} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Top items table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {isHe ? 'פריטים מובילים לפי הכנסה' : 'Top Items by Revenue'}
            <Badge variant="secondary" className="ms-2">{data.byItem.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto -mx-4 md:mx-0">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b">
                  <th className="pb-2 font-medium text-start ps-4 md:ps-0 w-8">#</th>
                  <th className="pb-2 font-medium text-start">{isHe ? 'קוד' : 'Code'}</th>
                  <th className="pb-2 font-medium text-start">{isHe ? 'תיאור' : 'Description'}</th>
                  <th className="pb-2 font-medium text-start">{isHe ? 'קטגוריה' : 'Category'}</th>
                  <th className="pb-2 font-medium text-end">{isHe ? 'הכנסה' : 'Revenue'}</th>
                  <th className="pb-2 font-medium text-end">{isHe ? 'כמות' : 'Qty'}</th>
                  <th className="pb-2 font-medium text-end">{isHe ? 'מחיר ממוצע' : 'Avg Price'}</th>
                  <th className="pb-2 font-medium text-end pe-4 md:pe-0">{isHe ? 'מרווח' : 'Margin'}</th>
                </tr>
              </thead>
              <tbody>
                {data.byItem.map((item, i) => (
                  <tr key={item.item_code} className="border-b hover:bg-muted/50 transition-colors">
                    <td className="py-2 ps-4 md:ps-0 text-muted-foreground tabular-nums">{i + 1}</td>
                    <td className="py-2 font-mono text-xs text-muted-foreground">
                      <ItemLink code={item.item_code} showCode />
                    </td>
                    <td className="py-2 truncate max-w-[220px]">
                      <ItemLink code={item.item_code} name={item.item_name || undefined} />
                    </td>
                    <td className="py-2 text-muted-foreground text-xs truncate max-w-[140px]">{item.category}</td>
                    <td className="py-2 text-end font-mono tabular-nums font-semibold">{formatCurrency(item.revenue)}</td>
                    <td className="py-2 text-end tabular-nums">{formatNumber(item.quantity)}</td>
                    <td className="py-2 text-end font-mono tabular-nums">{formatCurrency(item.avg_price)}</td>
                    <td className="py-2 text-end pe-4 md:pe-0">
                      {item.margin_pct == null ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-500">
                          <Hourglass className="h-3 w-3" />
                          {isHe ? 'בהמתנה' : 'pending'}
                        </span>
                      ) : (
                        <span className="font-semibold tabular-nums text-emerald-500">
                          {formatNumber(item.margin_pct, 1)}%
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {costPending && (
            <p className="text-[11px] text-muted-foreground mt-3">
              {isHe ? 'עמודת המרווח תתמלא כשמחיר העלות יחובר מ-FINAPI (7ITP).'
                    : 'The margin column will fill in once cost price is wired from FINAPI (7ITP).'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function MarginPage() {
  return (
    <Suspense fallback={<Skeleton className="w-full h-[600px]" />}>
      <MarginContent />
    </Suspense>
  )
}
