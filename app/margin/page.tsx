'use client'

import { Suspense, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useMargin, type MarginItem } from '@/hooks/use-margin'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemLink } from '@/components/shared/ItemLink'
import { formatNumber, formatCurrency, formatCurrencyAxis } from '@/lib/constants'
import { formatMarginPercent } from '@/lib/format'
import { isDeclineHidden } from '@/lib/privacy'
import {
  ScatterChart, Scatter, BarChart, Bar, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { ChartGrid, AXIS_PROPS, BAR_RADIUS, BAR_MAX, ChartTooltipShell, ANIM } from '@/components/charts/kit'
import {
  TrendingUp, Percent, Hourglass, BarChart3, AlertTriangle, Coins, Clock,
} from 'lucide-react'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'

// Margin buckets, in the order FINAPI emits them. `below_cost` is deliberately
// its own bucket and its own colour — a -3% part and a +3% part are not
// neighbours, one of them is a loss.
const BUCKET_ORDER = ['below_cost', '0-10', '10-20', '20-30', '30-40', '40-50', '50+']
const BUCKET_COLORS: Record<string, string> = {
  below_cost: '#ef4444',
  '0-10': '#f59e0b',
  '10-20': '#eab308',
  '20-30': '#84cc16',
  '30-40': '#10b981',
  '40-50': '#0ea5e9',
  '50+': '#6366f1',
}

function MarginContent() {
  // Subscribe to the demo-mode eye: formatCurrency() and formatMarginPercent()
  // mask from a module store, so without this the amounts here would not
  // re-render on toggle.
  useMoneyHidden()

  const { locale } = useLocale()
  const isHe = locale === 'he'
  const { data, isLoading, isError } = useMargin()

  // Loss-making parts are the definition of bad news, and the eye's contract is
  // that nothing left on screen with it closed is bad news. Masking the shekels
  // and leaving a card headed "selling below cost" up would keep the finding
  // fully legible — the item names and the count carry it on their own.
  const hideLosses = isDeclineHidden(true)

  const scatterData = useMemo(() => {
    if (!data?.byItem) return []
    return data.byItem.map((i) => ({
      x: i.revenue,
      y: i.quantity,
      z: i.avg_price,
      m: i.margin_pct,
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

  const distData = useMemo(() => {
    const d = data?.distribution
    if (!d) return []
    return BUCKET_ORDER.filter((k) => d[k]).map((k) => ({
      bucket: k === 'below_cost' ? (isHe ? 'מתחת לעלות' : 'below cost') : `${k}%`,
      key: k,
      items: d[k].items,
      revenue: d[k].revenue,
      profit: d[k].profit,
    }))
  }, [data, isHe])

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
  const fresh = data.freshness
  const costPending = !data.cost_available || s.est_gross_margin_pct == null
  const below = data.belowCost

  const kpis = [
    {
      icon: TrendingUp,
      label: isHe ? 'סה"כ הכנסה' : 'Total Revenue',
      value: formatCurrency(s.total_revenue),
      sub: `${formatNumber(s.items_evaluated)} ${isHe ? 'פריטים' : 'items'}`,
      color: 'text-primary',
    },
    {
      icon: Coins,
      label: isHe ? 'רווח גולמי' : 'Gross Profit',
      value: s.gross_profit != null ? formatCurrency(s.gross_profit) : (isHe ? 'בהמתנה' : 'Pending'),
      // A margin % on its own is the same number at ₪7M and at ₪70k. The scope
      // it was measured over belongs next to it, not in a footnote.
      sub: s.costed_revenue != null
        ? (isHe ? `על ${formatCurrency(s.costed_revenue)} מתומחרים` : `on ${formatCurrency(s.costed_revenue)} costed`)
        : undefined,
      color: 'text-emerald-500',
    },
    {
      icon: costPending ? Hourglass : Percent,
      label: isHe ? 'מרווח גולמי' : 'Gross Margin',
      value: costPending ? (isHe ? 'בהמתנה' : 'Pending') : formatMarginPercent(s.est_gross_margin_pct),
      sub: s.cost_pool
        ? (isHe ? `${formatNumber(s.items_costed ?? 0)} מתוך ${formatNumber(s.cost_pool)} במאגר` : `${formatNumber(s.items_costed ?? 0)} of ${formatNumber(s.cost_pool)} in pool`)
        : (isHe ? 'עלות בהמתנה (מחירון 06)' : 'cost pending (list 06)'),
      color: costPending ? 'text-amber-500' : 'text-emerald-500',
    },
    hideLosses
      ? {
          icon: BarChart3,
          label: isHe ? 'קטגוריות' : 'Categories',
          value: formatNumber(data.byCategory.length),
          sub: undefined as string | undefined,
          color: 'text-violet-500',
        }
      : {
          icon: AlertTriangle,
          label: isHe ? 'נמכר מתחת לעלות' : 'Sold Below Cost',
          value: formatNumber(below?.count ?? 0),
          sub: below?.lost_profit != null
            ? (isHe ? `${formatCurrency(below.lost_profit)} הפסד` : `${formatCurrency(below.lost_profit)} lost`)
            : undefined,
          color: (below?.count ?? 0) > 0 ? 'text-red-500' : 'text-muted-foreground',
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

      {/* Where the numbers come from and how old they are.
          Not a footnote: both lists move per ITEM on purchase, not on a
          schedule, so a current-looking list can still be backing a given part
          with a cost from last year. The per-row ⚠ carries that; this strip
          carries the shape of it. */}
      {fresh && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <Clock className="h-3.5 w-3.5" />
            {isHe ? 'טריות נתונים' : 'Data freshness'}
          </span>
          <span>
            {isHe ? 'מחירון 06 (עלות)' : 'List 06 (cost)'}:{' '}
            <span className="font-mono text-foreground">{fresh.cost_newest_date || '—'}</span>
            {fresh.cost_stale_items > 0 && (
              <span className="ms-1 text-amber-500">
                ({formatNumber(fresh.cost_stale_items)} {isHe ? `ישנים מ-${fresh.stale_after_days} ימים` : `older than ${fresh.stale_after_days}d`})
              </span>
            )}
          </span>
          {fresh.compare_price_code && (
            <span>
              {isHe ? 'מחירון 12 (נטו)' : 'List 12 (net)'}:{' '}
              <span className="font-mono text-foreground">{fresh.compare_newest_date || '—'}</span>
              {fresh.compare_stale_items > 0 && (
                <span className="ms-1 text-amber-500">
                  ({formatNumber(fresh.compare_stale_items)} {isHe ? 'ישנים' : 'stale'})
                </span>
              )}
            </span>
          )}
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

      {/* Margin distribution — where the catalogue actually sits */}
      {distData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {isHe ? 'התפלגות מרווח' : 'Margin Distribution'}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {isHe ? 'כמה פריטים בכל טווח מרווח. הכנסה ורווח בטולטיפ.'
                    : 'How many items sit in each margin band. Revenue and profit in the tooltip.'}
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] min-w-0">
              <ResponsiveContainer width="100%" height="100%" minHeight={120}>
                <BarChart data={distData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
                  <ChartGrid vertical />
                  <XAxis dataKey="bucket" {...AXIS_PROPS} />
                  <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatNumber(v)} />
                  <Tooltip
                    cursor={{ fill: 'var(--chart-grid)', fillOpacity: 0.25 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const p: any = payload[0].payload
                      return (
                        <ChartTooltipShell
                          title={p.bucket}
                          rows={[
                            { label: isHe ? 'פריטים' : 'Items', value: formatNumber(p.items), color: BUCKET_COLORS[p.key] },
                            { label: isHe ? 'הכנסה' : 'Revenue', value: formatCurrency(p.revenue) },
                            { label: isHe ? 'רווח' : 'Profit', value: formatCurrency(p.profit) },
                          ]}
                        />
                      )
                    }}
                  />
                  <Bar dataKey="items" radius={BAR_RADIUS.vertical} maxBarSize={BAR_MAX} {...ANIM.primary}>
                    {distData.map((d) => (
                      <Cell key={d.key} fill={BUCKET_COLORS[d.key] || '#6366f1'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* The two "best" questions, side by side — because they have different answers */}
      <div className="grid gap-4 lg:grid-cols-2">
        <LeaderBoard
          isHe={isHe}
          title={isHe ? 'המרווח הגבוה ביותר (%)' : 'Best Margin (%)'}
          note={
            (isHe ? 'מדורג לפי אחוז, עם רצפת הכנסה — מכירה בודדת ב-95% אינה תשובה.'
                  : 'Ranked by percentage, with a revenue floor — a single 95% sale is not an answer.')
            + ((s.suspect_cost_items ?? 0) > 0
                ? (isHe ? ` ${formatNumber(s.suspect_cost_items!)} פריטים הוחרגו — מחיר עלות לא סביר ב-7ITP (למשל ₪0.82 על דלת). שווה לתקן.`
                        : ` ${formatNumber(s.suspect_cost_items!)} items excluded — implausible cost in 7ITP (e.g. ₪0.82 on a door). Worth fixing.`)
                : '')
          }
          rows={data.bestMargin ?? []}
          primary="margin"
        />
        <LeaderBoard
          isHe={isHe}
          title={isHe ? 'הרווח הגבוה ביותר (₪)' : 'Best Profit (₪)'}
          note={isHe ? 'מדורג לפי שקלים. כמעט תמיד פריטים אחרים מאלה שמשמאל.'
                     : 'Ranked by shekels. Almost never the same items as the list beside it.'}
          rows={data.bestProfit ?? []}
          primary="profit"
        />
      </div>

      {/* Selling below cost */}
      {!hideLosses && (below?.items?.length ?? 0) > 0 && (
        <Card className="border-red-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              {isHe ? 'נמכר מתחת לעלות' : 'Sold Below Cost'}
              <Badge variant="destructive" className="ms-1">{formatNumber(below!.count)}</Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {isHe ? 'מחיר המכירה הממוצע נמוך ממחירון 06. בדוק אם העלות מעודכנת לפני שמשנים מחיר.'
                    : 'Average sell price is under list 06. Check the cost is current before repricing.'}
            </p>
          </CardHeader>
          <CardContent>
            <DataTable
              rows={below!.items}
              columns={BELOW_COST_COLUMNS(isHe)}
              getRowKey={it => it.item_code}
              defaultSort={{ field: 'profit', dir: 'asc' }}
              minWidth="min-w-[560px]"
              pageSize={25}
              exportFileName={isHe ? 'נמכר-מתחת-לעלות' : 'sold-below-cost'}
              mobileCard={{
                title: it => it.item_name || it.item_code,
                subtitle: it => it.item_code,
                accent: it => formatCurrency(it.profit),
                fields: [
                  { label: isHe ? 'הכנסה' : 'Revenue', value: it => formatCurrency(it.revenue) },
                  { label: isHe ? 'מרווח' : 'Margin', value: it => formatMarginPercent(it.margin_pct) },
                ],
              }}
            />
          </CardContent>
        </Card>
      )}

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
                <ChartGrid />
                <XAxis
                  type="number" dataKey="x" name={isHe ? 'הכנסה' : 'Revenue'}
                  {...AXIS_PROPS} tickFormatter={(v) => formatCurrencyAxis(v)}
                />
                <YAxis
                  type="number" dataKey="y" name={isHe ? 'כמות' : 'Quantity'}
                  {...AXIS_PROPS} tickFormatter={(v) => formatNumber(v)}
                />
                <ZAxis type="number" dataKey="z" range={[40, 400]} name={isHe ? 'מחיר' : 'Price'} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const p: any = payload[0].payload
                    return (
                      <ChartTooltipShell
                        title={p.name}
                        rows={[
                          { label: isHe ? 'הכנסה' : 'Revenue', value: formatCurrency(p.x) },
                          { label: isHe ? 'כמות' : 'Quantity', value: formatNumber(p.y) },
                          { label: isHe ? 'מחיר ממוצע' : 'Avg price', value: formatCurrency(p.z) },
                          ...(p.m != null
                            ? [{ label: isHe ? 'מרווח' : 'Margin', value: formatMarginPercent(p.m) }]
                            : []),
                        ]}
                      />
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
          <p className="text-xs text-muted-foreground">
            {isHe ? 'עלות = מחירון 06. נטו = מחירון 12 (להשוואה בלבד). פער = המרווח בפועל פחות מרווח מחירון 12.'
                  : 'Cost = list 06. Net = list 12 (comparison only). Gap = realised margin minus the list-12 margin.'}
          </p>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={data.byItem}
            columns={ITEM_COLUMNS(isHe)}
            getRowKey={it => it.item_code}
            defaultSort={{ field: 'revenue', dir: 'desc' }}
            minWidth="min-w-[980px]"
            pageSize={50}
            exportFileName={isHe ? 'רווחיות-לפי-פריט' : 'margin-by-item'}
            mobileCard={{
              title: it => it.item_name || it.item_code,
              subtitle: it => it.item_code,
              accent: it => formatCurrency(it.revenue),
              fields: [
                { label: isHe ? 'רווח' : 'Profit', value: it => (it.profit != null ? formatCurrency(it.profit) : '—') },
                { label: isHe ? 'מרווח' : 'Margin', value: it => <MarginCell item={it} isHe={isHe} /> },
              ],
            }}
          />
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

/** Cost with its age. A stale cost still computes a margin — it is flagged, not dropped. */
const BELOW_COST_COLUMNS = (isHe: boolean): DataTableColumn<MarginItem>[] => [
  {
    key: 'item_name',
    header: isHe ? 'פריט' : 'Item',
    sortable: true,
    truncate: 'max-w-[240px]',
    title: it => it.item_name || it.item_code,
    cell: it => <ItemLink code={it.item_code} name={it.item_name || undefined} />,
    exportValue: it => it.item_name || it.item_code,
  },
  {
    key: 'revenue',
    header: isHe ? 'הכנסה' : 'Revenue',
    align: 'end',
    sortable: true,
    cell: it => formatCurrency(it.revenue),
    exportValue: it => it.revenue,
    cellClassName: 'font-mono',
  },
  {
    key: 'cost',
    header: isHe ? 'עלות' : 'Cost',
    align: 'end',
    sortable: true,
    // CostCell carries the cost_suspect flag — a positive-but-absurd cost (a
    // ₪0.82 door behind a ₪59,110 sale) is the failure mode on this screen, not
    // a zero, so the cell has to keep saying which costs are not to be trusted.
    cell: it => <CostCell item={it} isHe={isHe} />,
    exportValue: it => it.cost ?? null,
    sortValue: it => it.cost ?? 0,
    cellClassName: 'font-mono',
  },
  {
    key: 'margin_pct',
    header: isHe ? 'מרווח' : 'Margin',
    align: 'end',
    sortable: true,
    cell: it => formatMarginPercent(it.margin_pct),
    exportValue: it => it.margin_pct ?? null,
    cellClassName: 'font-semibold text-red-500',
  },
  {
    key: 'profit',
    header: isHe ? 'הפסד' : 'Loss',
    align: 'end',
    sortable: true,
    cell: it => formatCurrency(it.profit),
    exportValue: it => it.profit,
    cellClassName: 'font-mono text-red-500',
  },
]

const LEADERBOARD_COLUMNS = (
  isHe: boolean,
  primary: 'margin' | 'profit',
): DataTableColumn<MarginItem>[] => [
  {
    key: 'rank',
    header: '#',
    // Position in the CURRENT sort, so it renumbers when the reader re-sorts —
    // and is left out of the export, where a rank means nothing once the sheet
    // is sorted again.
    cell: (_it, i) => <span className="tabular-nums text-muted-foreground">{i + 1}</span>,
    exportValue: null,
    headerClassName: 'w-6',
  },
  {
    key: 'item_name',
    header: isHe ? 'פריט' : 'Item',
    sortable: true,
    truncate: 'max-w-[220px]',
    title: it => it.item_name || it.item_code,
    cell: it => <ItemLink code={it.item_code} name={it.item_name || undefined} />,
    exportValue: it => it.item_name || it.item_code,
  },
  {
    key: 'revenue',
    header: isHe ? 'הכנסה' : 'Revenue',
    align: 'end',
    sortable: true,
    cell: it => formatCurrency(it.revenue),
    exportValue: it => it.revenue,
    cellClassName: 'font-mono text-muted-foreground',
  },
  {
    key: primary === 'margin' ? 'margin_pct' : 'profit',
    header: primary === 'margin' ? (isHe ? 'מרווח' : 'Margin') : (isHe ? 'רווח' : 'Profit'),
    align: 'end',
    sortable: true,
    cell: it =>
      primary === 'margin' ? formatMarginPercent(it.margin_pct) : formatCurrency(it.profit),
    exportValue: it => (primary === 'margin' ? it.margin_pct ?? null : it.profit),
    cellClassName: 'font-semibold text-emerald-500',
  },
]

const ITEM_COLUMNS = (isHe: boolean): DataTableColumn<MarginItem>[] => [
  { key: 'rank', header: '#', cell: (_it, i) => <span className="tabular-nums text-muted-foreground">{i + 1}</span>,
    exportValue: null, headerClassName: 'w-8' },
  { key: 'item_code', header: isHe ? 'קוד' : 'Code', sortable: true,
    cell: it => <ItemLink code={it.item_code} showCode />, exportValue: it => it.item_code,
    cellClassName: 'font-mono text-xs text-muted-foreground' },
  { key: 'item_name', header: isHe ? 'תיאור' : 'Description', sortable: true,
    truncate: 'max-w-[220px]', title: it => it.item_name || it.item_code,
    cell: it => <ItemLink code={it.item_code} name={it.item_name || undefined} />,
    exportValue: it => it.item_name || it.item_code },
  { key: 'category', header: isHe ? 'קטגוריה' : 'Category', sortable: true,
    truncate: 'max-w-[140px]', title: it => it.category ?? '',
    cell: it => it.category, exportValue: it => it.category ?? null,
    cellClassName: 'text-xs text-muted-foreground' },
  { key: 'revenue', header: isHe ? 'הכנסה' : 'Revenue', align: 'end', sortable: true,
    cell: it => formatCurrency(it.revenue), exportValue: it => it.revenue,
    cellClassName: 'font-mono font-semibold' },
  { key: 'quantity', header: isHe ? 'כמות' : 'Qty', align: 'end', sortable: true,
    cell: it => formatNumber(it.quantity), exportValue: it => it.quantity },
  { key: 'avg_price', header: isHe ? 'מחיר ממוצע' : 'Avg Price', align: 'end', sortable: true,
    cell: it => formatCurrency(it.avg_price), exportValue: it => it.avg_price,
    cellClassName: 'font-mono' },
  { key: 'cost', header: isHe ? 'עלות (06)' : 'Cost (06)', align: 'end', sortable: true,
    // Keeps CostCell: a positive-but-absurd cost is the failure mode here, and
    // the cell is what flags cost_suspect rows rather than pricing off them.
    cell: it => <CostCell item={it} isHe={isHe} />,
    exportValue: it => it.cost ?? null, sortValue: it => it.cost ?? 0,
    cellClassName: 'font-mono' },
  { key: 'compare_price', header: isHe ? 'נטו (12)' : 'Net (12)', align: 'end', sortable: true,
    cell: it => (it.compare_price != null ? formatCurrency(it.compare_price) : '—'),
    exportValue: it => it.compare_price ?? null,
    cellClassName: 'font-mono text-muted-foreground' },
  { key: 'profit', header: isHe ? 'רווח' : 'Profit', align: 'end', sortable: true,
    cell: it => (it.profit != null ? formatCurrency(it.profit) : '—'),
    exportValue: it => it.profit ?? null, cellClassName: 'font-mono' },
  { key: 'margin_pct', header: isHe ? 'מרווח' : 'Margin', align: 'end', sortable: true,
    cell: it => <MarginCell item={it} isHe={isHe} />,
    exportValue: it => it.margin_pct ?? null },
]

function CostCell({ item, isHe }: { item: MarginItem; isHe: boolean }) {
  if (item.cost == null) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        {isHe ? 'אין' : 'none'}
      </span>
    )
  }
  return (
    <span className={item.cost_stale ? 'text-amber-500' : undefined}
          title={item.cost_date ? `${isHe ? 'מתאריך' : 'as of'} ${item.cost_date}` : undefined}>
      {formatCurrency(item.cost)}
      {item.cost_stale && <span className="ms-1 text-[10px]">⚠</span>}
    </span>
  )
}

/** Margin, or an explicit "pending" — never a 0% standing in for an unknown. */
function MarginCell({ item, isHe }: { item: MarginItem; isHe: boolean }) {
  if (item.margin_pct == null) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-500">
        <Hourglass className="h-3 w-3" />
        {isHe ? 'בהמתנה' : 'pending'}
      </span>
    )
  }
  const negative = item.margin_pct < 0
  // A negative margin is bad news; with the eye closed the colour alone would
  // still broadcast it, so the cluster goes neutral rather than half-hidden.
  const tone = isDeclineHidden(negative)
    ? 'text-muted-foreground'
    : negative ? 'text-red-500' : 'text-emerald-500'
  return (
    <span className={`font-semibold tabular-nums ${tone}`}>
      {formatMarginPercent(item.margin_pct)}
    </span>
  )
}

function LeaderBoard({ isHe, title, note, rows, primary }: {
  isHe: boolean
  title: string
  note: string
  rows: MarginItem[]
  primary: 'margin' | 'profit'
}) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {title}
          <Badge variant="secondary" className="ms-2">{rows.length}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{note}</p>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {isHe ? 'אין נתונים — מחיר עלות חסר.' : 'No data — cost price missing.'}
          </p>
        ) : (
          <DataTable
            rows={rows}
            columns={LEADERBOARD_COLUMNS(isHe, primary)}
            getRowKey={it => it.item_code}
            minWidth="min-w-[420px]"
            pageSize={25}
            exportFileName={title}
            mobileCard={{
              title: it => it.item_name || it.item_code,
              subtitle: it => it.item_code,
              accent: it =>
                primary === 'margin' ? formatMarginPercent(it.margin_pct) : formatCurrency(it.profit),
              fields: [{ label: isHe ? 'הכנסה' : 'Revenue', value: it => formatCurrency(it.revenue) }],
            }}
          />
        )}
      </CardContent>
    </Card>
  )
}

export default function MarginPage() {
  return (
    <Suspense fallback={<Skeleton className="w-full h-[600px]" />}>
      <MarginContent />
    </Suspense>
  )
}
