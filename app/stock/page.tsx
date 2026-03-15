'use client'

import { useState, useMemo } from 'react'
import { useDeadStock } from '@/hooks/use-analytics'
import { useItems } from '@/hooks/use-dashboard'
import { useStockOptimization } from '@/hooks/use-ai-insights'
import { useLocale } from '@/lib/locale-context'
import { DeadStockTreemap } from '@/components/charts/DeadStockTreemap'
import { StockGaugeChart } from '@/components/charts/StockGaugeChart'
import { StreamingAnalysis } from '@/components/ai/StreamingAnalysis'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AnimatedCounter } from '@/components/shared/AnimatedCounter'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ArrowUpDown, Search, TableIcon, LayoutGrid } from 'lucide-react'
import type { DeadStockItem } from '@/lib/types'

type SortField = 'capital_tied' | 'stock_qty' | 'years_dead' | 'price' | 'name'
type SortDir = 'asc' | 'desc'

export default function StockPage() {
  const { t } = useLocale()
  const [yearsFilter, setYearsFilter] = useState(1)
  const { data, isLoading } = useDeadStock(yearsFilter)
  const { data: itemsData } = useItems()
  const { completion, isLoading: aiLoading, complete } = useStockOptimization()
  const [viewMode, setViewMode] = useState<'map' | 'table'>('table')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('capital_tied')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const deadItems = data?.items || []
  const totalCapital = data?.total_capital || 0

  // Compute real stock health from items data
  const allItems = itemsData?.items || []
  const itemsWithStock = allItems.filter((i: any) => i.stock_qty > 0)
  const totalStockItems = itemsWithStock.length
  const healthyItems = itemsWithStock.filter((i: any) => i.sold_this_year > 0 || i.sold_last_year > 0).length
  const slowMoving = itemsWithStock.filter((i: any) => i.sold_this_year === 0 && i.sold_last_year > 0).length
  const deadCount = itemsWithStock.filter((i: any) => i.sold_this_year === 0 && i.sold_last_year === 0).length

  const filteredItems = useMemo(() => {
    let result = deadItems
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter((i: DeadStockItem) => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q))
    }
    result = [...result].sort((a: DeadStockItem, b: DeadStockItem) => {
      let cmp: number
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else {
        cmp = (a[sortField] as number) - (b[sortField] as number)
      }
      return sortDir === 'desc' ? -cmp : cmp
    })
    return result
  }, [deadItems, searchQuery, sortField, sortDir])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  const SortHeader = ({ field, children, className }: { field: SortField; children: React.ReactNode; className?: string }) => (
    <th className={cn('pb-2 font-medium cursor-pointer select-none hover:text-foreground transition-colors', className)} onClick={() => handleSort(field)}>
      <span className="inline-flex items-center gap-1">
        {children}
        <ArrowUpDown className={cn('h-3 w-3', sortField === field ? 'text-foreground' : 'text-muted-foreground/50')} />
      </span>
    </th>
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Tabs value={String(yearsFilter)} onValueChange={(v) => setYearsFilter(Number(v))}>
          <TabsList>
            <TabsTrigger value="1">{t('dead1Year')}</TabsTrigger>
            <TabsTrigger value="2">{t('dead2Years')}</TabsTrigger>
            <TabsTrigger value="3">{t('dead3Years')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex gap-6">
          <div className="text-sm">
            <span className="text-muted-foreground">{t('items')}: </span>
            <AnimatedCounter value={deadItems.length} className="font-semibold" />
          </div>
          <div className="text-sm">
            <span className="text-muted-foreground">{t('capitalTied')}: </span>
            <AnimatedCounter value={totalCapital} format="currency" className="font-semibold" />
          </div>
        </div>
      </div>

      {/* Stock health summary from real data */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StockGaugeChart
          label={t('overall')}
          value={0}
          total={totalStockItems}
          healthy={healthyItems}
        />
        <Card>
          <CardContent className="p-4 text-center space-y-1">
            <p className="text-2xl font-bold text-emerald-500">{healthyItems}</p>
            <p className="text-xs text-muted-foreground">{t('healthy')}</p>
            <Badge variant="success" className="text-[10px]">{t('soldYear')}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center space-y-1">
            <p className="text-2xl font-bold text-amber-500">{slowMoving}</p>
            <p className="text-xs text-muted-foreground">Slow Moving</p>
            <Badge variant="warning" className="text-[10px]">Last year only</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center space-y-1">
            <p className="text-2xl font-bold text-red-500">{deadCount}</p>
            <p className="text-xs text-muted-foreground">{t('deadStock')}</p>
            <Badge variant="destructive" className="text-[10px]">No sales 2y+</Badge>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{t('deadStockMap')}</CardTitle>
              <div className="flex gap-1">
                <Button
                  variant={viewMode === 'table' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setViewMode('table')}
                >
                  <TableIcon className="h-4 w-4" />
                </Button>
                <Button
                  variant={viewMode === 'map' ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setViewMode('map')}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {viewMode === 'map' ? (
                <DeadStockTreemap data={deadItems} isLoading={isLoading} bare />
              ) : (
                <>
                  <div className="mb-3">
                    <div className="relative">
                      <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder={t('searchPlaceholder')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent ps-8 pe-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  </div>
                  <div className="overflow-x-auto max-h-[450px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background z-10">
                        <tr className="border-b">
                          <SortHeader field="name" className="text-start">{t('item')}</SortHeader>
                          <SortHeader field="stock_qty" className="text-end">{t('stock')}</SortHeader>
                          <SortHeader field="price" className="text-end">{t('price')}</SortHeader>
                          <SortHeader field="capital_tied" className="text-end">{t('capitalTiedShort')}</SortHeader>
                          <SortHeader field="years_dead" className="text-end">{t('yearsDead2')}</SortHeader>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredItems.map((item: DeadStockItem, idx: number) => (
                          <tr key={`${item.code}-${idx}`} className="border-b hover:bg-muted/50 transition-colors">
                            <td className="py-2">
                              <div className="font-medium">{item.name}</div>
                              <div className="text-xs text-muted-foreground">{item.code}</div>
                            </td>
                            <td className="py-2 text-end">{item.stock_qty}</td>
                            <td className="py-2 text-end font-mono">&#8362;{item.price.toLocaleString()}</td>
                            <td className="py-2 text-end font-mono font-semibold">&#8362;{item.capital_tied.toLocaleString()}</td>
                            <td className="py-2 text-end">
                              <Badge variant={item.years_dead >= 3 ? 'destructive' : item.years_dead >= 2 ? 'warning' : 'secondary'}>
                                {item.years_dead}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                        {filteredItems.length === 0 && (
                          <tr>
                            <td colSpan={5} className="py-8 text-center text-muted-foreground">
                              {t('noInsights')}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground text-end">
                    {filteredItems.length} {t('items')}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
        <StreamingAnalysis
          title={t('stockOptimizationAI')}
          completion={completion}
          isLoading={aiLoading}
          onStart={() => complete()}
        />
      </div>
    </div>
  )
}
