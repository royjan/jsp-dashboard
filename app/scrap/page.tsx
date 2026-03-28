'use client'

import { useState, useMemo, useCallback, Suspense } from 'react'
import { motion } from 'framer-motion'
import { useDeadStockSearch } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { ILS_FORMAT, NUMBER_FORMAT } from '@/lib/constants'
import { Search, Trash2, AlertTriangle, Package, ArrowUpDown, Download } from 'lucide-react'
import * as XLSX from 'xlsx'

type SortField = 'scrap_score' | 'capital_tied' | 'price' | 'qty' | 'item_name'
type SortDir = 'asc' | 'desc'

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
  const { locale } = useLocale()
  const isHe = locale === 'he'
  const [inputValue, setInputValue] = useState('')
  const [query, setQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('scrap_score')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [tableFilter, setTableFilter] = useState('')

  const { data, isLoading, isFetching } = useDeadStockSearch(query)

  const handleSearch = useCallback(() => {
    if (inputValue.trim().length >= 2) {
      setQuery(inputValue.trim())
    }
  }, [inputValue])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch()
  }, [handleSearch])

  const toggleSort = useCallback((field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }, [sortField])

  const sortedItems = useMemo(() => {
    if (!data?.items) return []
    let items = [...data.items]
    if (tableFilter) {
      const q = tableFilter.toLowerCase()
      items = items.filter((i: any) => i.item_name.toLowerCase().includes(q) || i.item_code.toLowerCase().includes(q))
    }
    items.sort((a: any, b: any) => {
      const av = a[sortField], bv = b[sortField]
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv, 'he') : bv.localeCompare(av, 'he')
      return sortDir === 'asc' ? av - bv : bv - av
    })
    return items
  }, [data, sortField, sortDir, tableFilter])

  const summary = data?.summary

  const exportToExcel = useCallback(() => {
    if (!sortedItems.length) return
    const rows = sortedItems.map((item: any, i: number) => ({
      '#': i + 1,
      [isHe ? 'קוד' : 'Code']: item.item_code,
      [isHe ? 'תיאור' : 'Description']: item.item_name,
      [isHe ? 'כמות' : 'Qty']: item.qty,
      [isHe ? 'מחיר' : 'Price']: Math.round(item.price),
      [isHe ? 'הון כלוא' : 'Capital Tied']: Math.round(item.capital_tied),
      [isHe ? 'נמכר השנה' : 'Sold This Year']: item.sold_this_year || 0,
      [isHe ? 'נמכר שנה שעברה' : 'Sold Last Year']: item.sold_last_year || 0,
      [isHe ? 'נמכר לפני שנתיים' : 'Sold 2Y Ago']: item.sold_2y_ago || 0,
      [isHe ? 'נמכר לפני 3+' : 'Sold 3Y+']: item.sold_3y_ago || 0,
      [isHe ? 'ציון גריטה' : 'Scrap Score']: item.scrap_score,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [
      { wch: 5 }, { wch: 14 }, { wch: 40 }, { wch: 8 }, { wch: 10 },
      { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
    ]
    if (isHe) ws['!dir'] = 'rtl'
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, isHe ? 'גריטה' : 'Scrap')
    XLSX.writeFile(wb, `scrap-${query}-${new Date().toISOString().split('T')[0]}.xlsx`)
  }, [sortedItems, query, isHe])

  const SortHeader = ({ field, children, className }: { field: SortField; children: React.ReactNode; className?: string }) => (
    <th
      className={cn('pb-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap', className)}
      onClick={() => toggleSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <ArrowUpDown className={cn('h-3 w-3 shrink-0', sortField === field ? 'text-primary' : 'text-muted-foreground/30')} />
        {sortField === field && <span className="text-primary text-[10px]">{sortDir === 'desc' ? '▼' : '▲'}</span>}
      </span>
    </th>
  )

  return (
    <div className="space-y-4 md:space-y-6">
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
              { icon: Package, label: isHe ? 'סה"כ פריטים' : 'Total Items', value: NUMBER_FORMAT.format(summary.total_items), sub: `${NUMBER_FORMAT.format(summary.total_units)} ${isHe ? 'יחידות' : 'units'}`, color: 'text-primary' },
              { icon: AlertTriangle, label: isHe ? 'הון כלוא' : 'Capital Tied', value: ILS_FORMAT.format(Math.round(summary.total_capital)), color: 'text-destructive' },
              { icon: Trash2, label: isHe ? 'מלאי מת (ללא מכירות שנה)' : 'Dead Stock (no sales 1Y)', value: `${summary.dead_items}`, sub: ILS_FORMAT.format(Math.round(summary.dead_capital)), color: 'text-amber-500' },
              { icon: Trash2, label: isHe ? 'אף פעם לא נמכרו' : 'Never Sold', value: `${summary.never_sold_items}`, sub: ILS_FORMAT.format(Math.round(summary.never_sold_capital)), color: 'text-destructive' },
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
                  <Badge variant="secondary" className="ms-2">{sortedItems.length}</Badge>
                  {isFetching && <span className="text-xs text-muted-foreground ms-2 animate-pulse">{isHe ? 'טוען...' : 'Loading...'}</span>}
                </CardTitle>
                <button
                  onClick={exportToExcel}
                  disabled={!sortedItems.length}
                  className="h-8 px-3 rounded-md border border-input text-xs font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-1.5 shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  Excel
                </button>
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
              <div className="overflow-x-auto max-h-[600px] overflow-y-auto -mx-4 md:mx-0">
                <table className="w-full text-sm min-w-[800px]">
                  <thead className="sticky top-0 bg-background z-10">
                    <tr className="border-b">
                      <th className="pb-2 font-medium text-start ps-4 md:ps-0 w-8">#</th>
                      <th className="pb-2 font-medium text-start">{isHe ? 'קוד' : 'Code'}</th>
                      <SortHeader field="item_name" className="text-start">{isHe ? 'תיאור' : 'Description'}</SortHeader>
                      <SortHeader field="qty" className="text-end">{isHe ? 'כמות' : 'Qty'}</SortHeader>
                      <SortHeader field="price" className="text-end">{isHe ? 'מחיר' : 'Price'}</SortHeader>
                      <SortHeader field="capital_tied" className="text-end">{isHe ? 'הון כלוא' : 'Capital'}</SortHeader>
                      <th className="pb-2 font-medium text-start">{isHe ? 'מכירות' : 'Sales'}</th>
                      <SortHeader field="scrap_score" className="text-end pe-4 md:pe-0">{isHe ? 'ציון גריטה' : 'Scrap Score'}</SortHeader>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.map((item: any, i: number) => (
                      <motion.tr
                        key={item.item_code}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: Math.min(i * 0.01, 0.5) }}
                        className="border-b hover:bg-muted/50 transition-colors"
                      >
                        <td className="py-2 ps-4 md:ps-0 text-muted-foreground tabular-nums">{i + 1}</td>
                        <td className="py-2 font-mono text-xs text-muted-foreground">{item.item_code}</td>
                        <td className="py-2 truncate max-w-[220px]">{item.item_name}</td>
                        <td className="py-2 text-end tabular-nums">{NUMBER_FORMAT.format(item.qty)}</td>
                        <td className="py-2 text-end font-mono tabular-nums">{ILS_FORMAT.format(Math.round(item.price))}</td>
                        <td className="py-2 text-end font-mono tabular-nums font-semibold text-destructive">{ILS_FORMAT.format(Math.round(item.capital_tied))}</td>
                        <td className="py-2">{getSalesLabel(item, isHe)}</td>
                        <td className="py-2 pe-4 md:pe-0">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className={cn('h-full rounded-full', getScoreBg(item.scrap_score))} style={{ width: `${Math.min(item.scrap_score, 100)}%` }} />
                            </div>
                            <span className={cn('font-bold tabular-nums text-sm min-w-[28px] text-end', getScoreColor(item.scrap_score))}>
                              {item.scrap_score}
                            </span>
                          </div>
                        </td>
                      </motion.tr>
                    ))}
                    {sortedItems.length === 0 && (
                      <tr><td colSpan={8} className="py-12 text-center text-muted-foreground">
                        {isHe ? 'לא נמצאו פריטים' : 'No items found'}
                      </td></tr>
                    )}
                  </tbody>
                  {sortedItems.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 font-semibold">
                        <td colSpan={3} className="py-2 ps-4 md:ps-0">
                          {isHe ? `סה"כ ${sortedItems.length} פריטים` : `Total ${sortedItems.length} items`}
                        </td>
                        <td className="py-2 text-end tabular-nums">{NUMBER_FORMAT.format(sortedItems.reduce((s: number, i: any) => s + i.qty, 0))}</td>
                        <td className="py-2" />
                        <td className="py-2 text-end font-mono tabular-nums text-destructive">
                          {ILS_FORMAT.format(Math.round(sortedItems.reduce((s: number, i: any) => s + i.capital_tied, 0)))}
                        </td>
                        <td colSpan={2} className="py-2" />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
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

export default function ScrapPage() {
  return (
    <Suspense fallback={<Skeleton className="w-full h-[600px]" />}>
      <ScrapContent />
    </Suspense>
  )
}
