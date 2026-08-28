'use client'

import { useState, useMemo, useCallback, Suspense } from 'react'
import { motion } from 'framer-motion'
import { useDeadStockSearch } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { ItemLink } from '@/components/shared/ItemLink'
import { EbayRecommendButton } from '@/components/shared/EbayRecommendButton'
import { Search, Trash2, AlertTriangle, Package, ShoppingCart, Loader2 } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { PageHeader } from '@/components/shared/PageHeader'


function getScoreColor(score: number) {
  if (score >= 75) return 'text-red-500'
  if (score >= 65) return 'text-orange-500'
  if (score >= 55) return 'text-yellow-500'
  return 'text-muted-foreground'
}

function getScoreBg(score: number) {
  if (score >= 75) return 'bg-red-500'
  if (score >= 65) return 'bg-orange-500'
  if (score >= 55) return 'bg-yellow-500'
  return 'bg-muted-foreground'
}

function getSalesLabel(item: any, isHe: boolean) {
  const total = (item.sold_this_year || 0) + (item.sold_last_year || 0) + (item.sold_2y_ago || 0) + (item.sold_3y_ago || 0)
  if (total === 0) return <span className="text-destructive font-semibold">{isHe ? 'אף פעם' : 'Never'}</span>
  const parts: string[] = []
  if (item.sold_this_year > 0) parts.push(isHe ? `השנה: ${item.sold_this_year}` : `This Y: ${item.sold_this_year}`)
  if (item.sold_last_year > 0) parts.push(isHe ? `שנה שעברה: ${item.sold_last_year}` : `Last Y: ${item.sold_last_year}`)
  if (item.sold_2y_ago > 0) parts.push(isHe ? `לפני שנתיים: ${item.sold_2y_ago}` : `2Y ago: ${item.sold_2y_ago}`)
  if (item.sold_3y_ago > 0) parts.push(isHe ? `לפני 3+: ${item.sold_3y_ago}` : `3Y+: ${item.sold_3y_ago}`)
  return (
    <span>
      <span className="text-amber-500">{isHe ? `סה"כ ${total}` : `Total ${total}`}</span>
      <br />
      <span className="text-[11px] text-muted-foreground">{parts.join(' | ')}</span>
    </span>
  )
}

function ScrapContent() {
  const { t } = useLocale()
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

  const { locale } = useLocale()
  const isHe = locale === 'he'
  const [inputValue, setInputValue] = useState('')
  const [query, setQuery] = useState('')
  const [tableFilter, setTableFilter] = useState('')

  const [ebayExporting, setEbayExporting] = useState(false)
  const [ebayExportResult, setEbayExportResult] = useState<{ count: number; url: string } | null>(null)

  const { data, isLoading, isFetching } = useDeadStockSearch(query)

  const handleSearch = useCallback(() => {
    if (inputValue.trim().length >= 2) {
      setQuery(inputValue.trim())
    }
  }, [inputValue])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }, [handleSearch])


  // Filtering only. Sorting moved into DataTable, which does it with the shared
  // comparator — Hebrew-aware, ISO dates chronological, blanks last — instead of
  // this local `av - bv`, which put every blank at one end and compared Hebrew
  // by code point.
  const sortedItems = useMemo(() => {
    if (!data?.items) return []
    if (!tableFilter) return data.items
    const q = tableFilter.toLowerCase()
    return data.items.filter(
      (i: any) => i.item_name.toLowerCase().includes(q) || i.item_code.toLowerCase().includes(q),
    )
  }, [data, tableFilter])

  const summary = data?.summary


  const exportToEbay = useCallback(async () => {
    if (!sortedItems.length) return
    setEbayExporting(true)
    setEbayExportResult(null)
    try {
      const itemCodes = sortedItems.map((i: any) => i.item_code)
      const res = await fetch('/api/analytics/dead-stock/export-to-ebay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_codes: itemCodes, min_score: 0 }),
      })
      if (!res.ok) throw new Error('Export failed')
      const payload = await res.json()

      // Download as JSON file
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `dead-stock-ebay-${query || 'all'}-${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setEbayExportResult({ count: payload.count, url })
    } catch (err) {
      console.error('eBay export failed:', err)
    } finally {
      setEbayExporting(false)
    }
  }, [sortedItems, query])


  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader title={t('scrap')} icon={Trash2} />
      {/* Search bar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute start-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isHe ? 'הקלד תיאור פריט לחיפוש... (למשל: בטנה, מגן, פנס)' : 'Enter part description to search... (e.g. fender, bumper, lamp)'}
                className="flex h-10 w-full rounded-md border border-input bg-transparent ps-9 pe-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={inputValue.trim().length < 2}
              className="h-10 px-6 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isHe ? 'חפש' : 'Search'}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {[
              { label: isHe ? 'בטנות' : 'Fender Liners', q: 'בטנ' },
              { label: isHe ? 'מגנים' : 'Bumpers', q: 'מגן' },
              { label: isHe ? 'פנסים' : 'Lights', q: 'פנס' },
              { label: isHe ? 'מראות' : 'Mirrors', q: 'מראה' },
              { label: isHe ? 'דלתות' : 'Doors', q: 'דלת' },
              { label: isHe ? 'רדיאטורים' : 'Radiators', q: 'רדיאטור' },
              { label: isHe ? 'מסננים' : 'Filters', q: 'מסנן' },
            ].map(preset => (
              <button
                key={preset.q}
                onClick={() => { setInputValue(preset.q); setQuery(preset.q) }}
                className={cn(
                  'text-xs px-3 py-1.5 rounded-full border transition-colors',
                  query === preset.q
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'text-muted-foreground border-border hover:text-foreground hover:border-muted-foreground'
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {isLoading && query && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-2" /><Skeleton className="h-8 w-24" /></CardContent></Card>)}
          </div>
          <Card><CardContent className="p-4"><Skeleton className="h-[400px] w-full" /></CardContent></Card>
        </div>
      )}

      {/* Results */}
      {summary && !isLoading && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
            {[
              { icon: Package, label: isHe ? 'סה"כ פריטים' : 'Total Items', value: formatNumber(summary.total_items), sub: `${formatNumber(summary.total_units)} ${isHe ? 'יחידות' : 'units'}`, color: 'text-primary' },
              { icon: AlertTriangle, label: isHe ? 'הון כלוא' : 'Capital Tied', value: formatCurrency(Math.round(summary.total_capital)), color: 'text-destructive' },
              { icon: Trash2, label: isHe ? 'מלאי מת (ללא מכירות שנה)' : 'Dead Stock (no sales 1Y)', value: formatNumber(summary.dead_items), sub: formatCurrency(Math.round(summary.dead_capital)), color: 'text-amber-500' },
              { icon: Trash2, label: isHe ? 'אף פעם לא נמכרו' : 'Never Sold', value: formatNumber(summary.never_sold_items), sub: formatCurrency(Math.round(summary.never_sold_capital)), color: 'text-destructive' },
            ].map((kpi, i) => (
              <motion.div key={kpi.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                <Card className="overflow-hidden h-full">
                  <CardContent className="p-3 md:p-4">
                    <div className="flex items-center gap-2 text-muted-foreground text-xs mb-2">
                      <kpi.icon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{kpi.label}</span>
                    </div>
                    <div className={cn('text-lg md:text-2xl font-bold tabular-nums', kpi.color)}>{kpi.value}</div>
                    {kpi.sub && <div className="text-[11px] text-muted-foreground mt-1">{kpi.sub}</div>}
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </div>

          {/* Score legend */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground px-1">
            <span className="font-medium">{isHe ? 'ציון גריטה:' : 'Scrap Score:'}</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> 75+ {isHe ? 'להעיף מיד' : 'Scrap now'}</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> 65-74 {isHe ? 'חיסול' : 'Liquidate'}</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-yellow-500" /> 55-64 {isHe ? 'מבצע' : 'Discount'}</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-muted-foreground" /> &lt;55 {isHe ? 'נמוך' : 'Low'}</span>
          </div>

          {/* Table */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <CardTitle className="text-base">
                  {isHe ? `תוצאות חיפוש: "${query}"` : `Search results: "${query}"`}
                  <Badge variant="secondary" className="ms-2">{formatNumber(sortedItems.length)}</Badge>
                  {isFetching && <span className="text-xs text-muted-foreground ms-2 animate-pulse">{isHe ? 'טוען...' : 'Loading...'}</span>}
                </CardTitle>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={exportToEbay}
                    disabled={!sortedItems.length || ebayExporting}
                    className="h-8 px-3 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5"
                  >
                    {ebayExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShoppingCart className="h-3.5 w-3.5" />}
                    {isHe ? 'ייצוא ל-eBay' : 'Export to eBay'}
                  </button>
                  {ebayExportResult && (
                    <span className="text-[11px] text-green-500">
                      {isHe ? `${ebayExportResult.count} פריטים יוצאו` : `${ebayExportResult.count} items exported`}
                    </span>
                  )}
                </div>
                <div className="relative min-w-[160px] sm:max-w-xs">
                  <Search className="absolute start-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    value={tableFilter}
                    onChange={(e) => setTableFilter(e.target.value)}
                    placeholder={isHe ? 'סנן בתוצאות...' : 'Filter results...'}
                    className="flex h-8 w-full rounded-md border border-input bg-transparent ps-8 pe-3 py-1 text-xs shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <DataTable
                rows={sortedItems}
                columns={SCRAP_COLUMNS(isHe)}
                getRowKey={(i: ScrapItem) => i.item_code}
                loading={isLoading}
                pageSize={50}
                defaultSort={{ field: 'scrap_score', dir: 'desc' }}
                exportFileName={`scrap-${query}`}
                labels={{ empty: isHe ? 'לא נמצאו פריטים' : 'No items found' }}
                minWidth="min-w-[800px]"
                // The totals row is why this table could not move over before:
                // DataTable had no <tfoot> slot, and migrating without one would
                // have dropped the capital total off a dead-stock screen.
                // It sums the WHOLE result, not the visible page — a total that
                // silently followed the pager would be the more dangerous number.
                footer={(_shown: ScrapItem[], all: ScrapItem[]) => (
                  <tr>
                    <td colSpan={3} className="py-2">
                      {isHe ? `סה"כ ${formatNumber(all.length)} פריטים` : `Total ${formatNumber(all.length)} items`}
                    </td>
                    <td className="py-2 text-end tabular-nums">
                      {formatNumber(all.reduce((sum, i) => sum + i.qty, 0))}
                    </td>
                    <td className="py-2" />
                    <td className="py-2 text-end font-mono tabular-nums text-destructive">
                      {formatCurrency(Math.round(all.reduce((sum, i) => sum + i.capital_tied, 0)))}
                    </td>
                    <td colSpan={2} className="py-2" />
                  </tr>
                )}
                mobileCard={{
                  title: (i: ScrapItem) => i.item_name,
                  subtitle: (i: ScrapItem) => i.item_code,
                  accent: (i: ScrapItem) => formatCurrency(Math.round(i.capital_tied)),
                  fields: [
                    { label: isHe ? 'כמות' : 'Qty', value: (i: ScrapItem) => formatNumber(i.qty) },
                    { label: isHe ? 'ציון' : 'Score', value: (i: ScrapItem) => i.scrap_score },
                  ],
                }}
              />
            </CardContent>
          </Card>
        </>
      )}

      {/* Empty state */}
      {!query && !isLoading && (
        <Card>
          <CardContent className="py-16 text-center">
            <Trash2 className="h-16 w-16 mx-auto mb-4 text-muted-foreground/30" />
            <p className="text-lg font-medium mb-2">{isHe ? 'חיפוש מלאי לגריטה' : 'Dead Stock Scrap Search'}</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {isHe
                ? 'הקלד תיאור פריט (למשל "בטנה", "מגן", "פנס") כדי לקבל ניתוח מלאי מת עם ציון גריטה — ככל שהציון גבוה יותר, כדאי יותר להיפטר מהפריט'
                : 'Enter a part description (e.g. "fender", "bumper", "lamp") to get dead stock analysis with scrap scores — higher score = should get rid of first'
              }
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** One dead-stock candidate, as /api/analytics/dead-stock/search returns it. */
interface ScrapItem {
  item_code: string
  item_name: string
  qty: number
  price: number
  capital_tied: number
  sold_this_year: number
  sold_last_year: number
  sold_2y_ago: number
  sold_3y_ago: number
  scrap_score: number
}

/**
 * Columns lifted verbatim from the hand-rolled table this page used to carry —
 * same renderers, same alignment, same helpers. The only additions are
 * `exportValue`, so the xlsx gets RAW numbers rather than "₪1,204" strings that
 * Excel cannot sum, and `sortValue` where the sort key is not the field itself.
 */
const SCRAP_COLUMNS = (isHe: boolean): DataTableColumn<ScrapItem>[] => [
  {
    key: 'idx',
    header: '#',
    cell: (_i: ScrapItem, index: number) => <span className="text-muted-foreground tabular-nums">{index + 1}</span>,
    // A row number is a property of the view, not of the item; exporting it
    // would put a column in the workbook that means nothing once it is sorted.
    exportValue: null,
  },
  {
    key: 'item_code',
    header: isHe ? 'קוד' : 'Code',
    sortable: true,
    cell: (i: ScrapItem) => (
      <div className="flex items-center gap-1.5">
        <EbayRecommendButton itemCode={i.item_code} itemName={i.item_name} source="scrap_analysis" />
        <ItemLink code={i.item_code} showCode />
      </div>
    ),
    exportValue: (i: ScrapItem) => i.item_code,
    cellClassName: 'font-mono text-xs text-muted-foreground',
  },
  {
    key: 'item_name',
    header: isHe ? 'תיאור' : 'Description',
    sortable: true,
    truncate: 'max-w-[220px]',
    title: (i: ScrapItem) => i.item_name,
    cell: (i: ScrapItem) => <ItemLink code={i.item_code} name={i.item_name} />,
    exportValue: (i: ScrapItem) => i.item_name,
  },
  {
    key: 'qty',
    header: isHe ? 'כמות' : 'Qty',
    align: 'end',
    sortable: true,
    cell: (i: ScrapItem) => formatNumber(i.qty),
    exportValue: (i: ScrapItem) => i.qty,
  },
  {
    key: 'price',
    header: isHe ? 'מחיר' : 'Price',
    align: 'end',
    sortable: true,
    cell: (i: ScrapItem) => formatCurrency(Math.round(i.price)),
    exportValue: (i: ScrapItem) => Math.round(i.price),
    cellClassName: 'font-mono',
  },
  {
    key: 'capital_tied',
    header: isHe ? 'הון כלוא' : 'Capital',
    align: 'end',
    sortable: true,
    cell: (i: ScrapItem) => formatCurrency(Math.round(i.capital_tied)),
    exportValue: (i: ScrapItem) => Math.round(i.capital_tied),
    cellClassName: 'font-mono font-semibold text-destructive',
  },
  {
    key: 'sales',
    header: isHe ? 'מכירות' : 'Sales',
    cell: (i: ScrapItem) => getSalesLabel(i, isHe),
    // getSalesLabel returns a node; the export wants the underlying counts.
    exportValue: (i: ScrapItem) =>
      [i.sold_this_year, i.sold_last_year, i.sold_2y_ago, i.sold_3y_ago]
        .map((n: number) => n || 0)
        .join(' / '),
  },
  {
    key: 'scrap_score',
    header: isHe ? 'ציון גריטה' : 'Scrap Score',
    align: 'end',
    sortable: true,
    cell: (i: ScrapItem) => (
      <div className="flex items-center justify-end gap-2">
        <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full', getScoreBg(i.scrap_score))}
            style={{ width: `${Math.min(i.scrap_score, 100)}%` }}
          />
        </div>
        <span className={cn('min-w-[28px] text-end text-sm font-bold tabular-nums', getScoreColor(i.scrap_score))}>
          {i.scrap_score}
        </span>
      </div>
    ),
    exportValue: (i: ScrapItem) => i.scrap_score,
  },
]

export default function ScrapPage() {
  return (
    <Suspense fallback={<Skeleton className="w-full h-[600px]" />}>
      <ScrapContent />
    </Suspense>
  )
}
