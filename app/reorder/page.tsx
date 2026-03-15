'use client'

import { useState, useMemo } from 'react'
import { useReorderRecommendations } from '@/hooks/use-analytics'
import { useReorderAnalysis } from '@/hooks/use-ai-insights'
import { useLocale } from '@/lib/locale-context'
import { ReorderRadarChart } from '@/components/charts/ReorderRadarChart'
import { StreamingAnalysis } from '@/components/ai/StreamingAnalysis'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { ArrowUpDown, Search } from 'lucide-react'
import type { ReorderItem } from '@/lib/types'

type SortField = 'urgency_score' | 'stock_qty' | 'inquiry_count' | 'sold_this_year' | 'name'
type SortDir = 'asc' | 'desc'
type UrgencyFilter = 'all' | 'critical' | 'high' | 'medium' | 'low'

function getUrgencyLevel(score: number): UrgencyFilter {
  if (score > 10) return 'critical'
  if (score > 5) return 'high'
  if (score > 2) return 'medium'
  return 'low'
}

function getUrgencyBadge(score: number, labels: { critical: string; high: string; medium: string; low: string }) {
  if (score > 10) return <Badge variant="destructive">{labels.critical}</Badge>
  if (score > 5) return <Badge variant="warning">{labels.high}</Badge>
  if (score > 2) return <Badge variant="secondary">{labels.medium}</Badge>
  return <Badge variant="outline">{labels.low}</Badge>
}

export default function ReorderPage() {
  const { t } = useLocale()
  const { data, isLoading } = useReorderRecommendations()
  const { completion, isLoading: aiLoading, complete } = useReorderAnalysis()
  const [selectedItem, setSelectedItem] = useState<ReorderItem | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('all')
  const [sortField, setSortField] = useState<SortField>('urgency_score')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const items: ReorderItem[] = data?.items || []

  const filteredItems = useMemo(() => {
    let result = items

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(i => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q))
    }

    if (urgencyFilter !== 'all') {
      result = result.filter(i => getUrgencyLevel(i.urgency_score) === urgencyFilter)
    }

    result.sort((a, b) => {
      let cmp: number
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else {
        cmp = (a[sortField] as number) - (b[sortField] as number)
      }
      return sortDir === 'desc' ? -cmp : cmp
    })

    return result
  }, [items, searchQuery, urgencyFilter, sortField, sortDir])

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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('reorderRecommendations')}</CardTitle>
              <p className="text-sm text-muted-foreground">{t('urgencyFormula')}</p>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="w-full h-[400px]" />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder={t('searchPlaceholder')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent ps-8 pe-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    <Select value={urgencyFilter} onValueChange={(v) => setUrgencyFilter(v as UrgencyFilter)}>
                      <SelectTrigger className="w-[140px] h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('allUrgencies')}</SelectItem>
                        <SelectItem value="critical">{t('critical')}</SelectItem>
                        <SelectItem value="high">{t('high')}</SelectItem>
                        <SelectItem value="medium">{t('medium')}</SelectItem>
                        <SelectItem value="low">{t('low')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground">{filteredItems.length} / {items.length}</span>
                  </div>
                  <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background z-10">
                        <tr className="border-b">
                          <SortHeader field="name" className="text-start">{t('item')}</SortHeader>
                          <SortHeader field="stock_qty" className="text-end">{t('stock')}</SortHeader>
                          <SortHeader field="inquiry_count" className="text-end">{t('inquiries')}</SortHeader>
                          <SortHeader field="sold_this_year" className="text-end">{t('soldYear')}</SortHeader>
                          <SortHeader field="urgency_score" className="text-end">{t('score')}</SortHeader>
                          <th className="pb-2 font-medium text-start">{t('urgency')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredItems.map((item, idx) => (
                          <tr
                            key={`${item.code}-${idx}`}
                            className={cn(
                              'border-b hover:bg-muted/50 cursor-pointer transition-colors',
                              selectedItem?.code === item.code && 'bg-muted'
                            )}
                            onClick={() => setSelectedItem(item)}
                          >
                            <td className="py-2">
                              <div className="font-medium">{item.name}</div>
                              <div className="text-xs text-muted-foreground">{item.code}</div>
                            </td>
                            <td className="py-2 text-end">{item.stock_qty}</td>
                            <td className="py-2 text-end">{item.inquiry_count}</td>
                            <td className="py-2 text-end">{item.sold_this_year}</td>
                            <td className="py-2 text-end font-mono">{item.urgency_score}</td>
                            <td className="py-2">{getUrgencyBadge(item.urgency_score, { critical: t('critical'), high: t('high'), medium: t('medium'), low: t('low') })}</td>
                          </tr>
                        ))}
                        {filteredItems.length === 0 && (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-muted-foreground">
                              {t('noInsights')}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {selectedItem && <ReorderRadarChart item={selectedItem} />}
          <StreamingAnalysis
            title={t('aiReorderAnalysis')}
            completion={completion}
            isLoading={aiLoading}
            onStart={() => complete()}
          />
        </div>
      </div>
    </div>
  )
}
