'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useLocale } from '@/lib/locale-context'
import { formatNumber } from '@/lib/constants'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ItemLink } from '@/components/shared/ItemLink'
import { useSortable, SortableTh } from '@/components/shared/sortable-table'
import { Loader2, TrendingDown, Search } from 'lucide-react'
import { formatDate } from '@/lib/format'

interface DemandItem {
  itemCode: string
  itemName: string
  purchasedQty: number
  orders: number
  lastOrder: string | null
  spend: number
  avgMonthlySales: number
  stockQty: number | null
  coverMonths: number | null
}
interface DemandResponse {
  items: DemandItem[]
  summary?: { items: number; totalSpend: number; noSales: number; lowCover: number }
  error?: string
}

/**
 * What we buy from this supplier, and how fast it moves. Rows are ordered by
 * quantity purchased; `coverMonths` (stock ÷ monthly sales) is the reorder
 * signal — low means running out, and "—" means no sales history to judge by
 * rather than a comfortable position.
 */
type Quick = 'all' | 'low' | 'nosales'

export default function SupplierDemandPage() {
  const { t } = useLocale()
  const { code } = useParams<{ code: string }>()
  const [q, setQ] = useState('')
  const [quick, setQuick] = useState<Quick>('all')

  const { data, isLoading } = useQuery<DemandResponse>({
    queryKey: ['supplier-demand', code],
    queryFn: async () => {
      const res = await fetch(`/api/suppliers/${encodeURIComponent(code)}/demand`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!code,
    staleTime: 5 * 60 * 1000,
  })

  const items = useMemo(() => data?.items || [], [data])
  const summary = data?.summary

  // Filter first, then sort — so sorting applies to what is actually shown.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter((i) => {
      if (quick === 'low' && !(i.coverMonths != null && i.coverMonths < 1)) return false
      if (quick === 'nosales' && i.avgMonthlySales > 0) return false
      if (!needle) return true
      return (
        i.itemCode.toLowerCase().includes(needle) ||
        (i.itemName || '').toLowerCase().includes(needle)
      )
    })
  }, [items, q, quick])

  const { sorted, sortKey, sortDir, toggleSort } = useSortable<DemandItem>(filtered, {
    key: 'purchasedQty',
    dir: 'desc',
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{t('suppliers.loadingDemand')}</span>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
        <TrendingDown className="h-6 w-6" />
        <span>{t('suppliers.noDemand')}</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: t('suppliers.itemsBought'), value: formatNumber(summary.items) },
            { label: t('suppliers.totalSpend'), value: `₪${formatNumber(Math.round(summary.totalSpend))}` },
            { label: t('suppliers.lowCover'), value: formatNumber(summary.lowCover), warn: summary.lowCover > 0 },
            { label: t('suppliers.noSales'), value: formatNumber(summary.noSales), warn: summary.noSales > 0 },
          ].map((k, i) => (
            <Card key={i}>
              <CardContent className="p-3 space-y-0.5">
                <div className="text-xs text-muted-foreground">{k.label}</div>
                <div className={`text-lg font-bold tabular-nums ${k.warn ? 'text-amber-500' : ''}`}>{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Search + quick filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute start-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('suppliers.searchItems')}
            className="w-full rounded border ps-7 pe-2 py-1.5 text-sm bg-background"
          />
        </div>
        {([
          { key: 'all', label: t('suppliers.all') },
          { key: 'low', label: t('suppliers.lowCover') },
          { key: 'nosales', label: t('suppliers.noSales') },
        ] as const).map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={quick === f.key ? 'default' : 'outline'}
            className="h-7 text-xs"
            onClick={() => setQuick(f.key)}
          >
            {f.label}
          </Button>
        ))}
        <span className="text-xs text-muted-foreground tabular-nums ms-auto">
          {formatNumber(sorted.length)} / {formatNumber(items.length)}
        </span>
      </div>

      {/* Bounded height makes THIS the scroll container, which is what a sticky
          thead latches onto — inside a plain overflow-x-auto wrapper the header
          has nothing to stick to. Header background must be opaque. */}
      <div className="rounded border overflow-auto max-h-[calc(100vh-24rem)]">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="sticky top-0 z-20 bg-card">
            <tr className="border-b">
              <SortableTh<DemandItem> label={t('suppliers.itemCode')} sortKey="itemCode" align="start" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-3 py-2 text-xs" />
              <SortableTh<DemandItem> label={t('suppliers.itemName')} sortKey="itemName" align="start" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-3 py-2 text-xs" />
              <SortableTh<DemandItem> label={t('suppliers.bought')} sortKey="purchasedQty" align="end" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-3 py-2 text-xs" />
              <SortableTh<DemandItem> label={t('suppliers.soldPerMonth')} sortKey="avgMonthlySales" align="end" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-3 py-2 text-xs" />
              <SortableTh<DemandItem> label={t('suppliers.stock')} sortKey="stockQty" align="end" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-3 py-2 text-xs" />
              <SortableTh<DemandItem> label={t('suppliers.cover')} sortKey="coverMonths" align="end" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-3 py-2 text-xs" hint={t('suppliers.coverHint')} />
              <SortableTh<DemandItem> label={t('suppliers.lastOrder')} sortKey="lastOrder" align="start" activeKey={sortKey} sortDir={sortDir} onSort={toggleSort} className="px-3 py-2 text-xs" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((i) => (
              <tr key={i.itemCode} className="border-t hover:bg-accent/50">
                <td className="px-3 py-2"><ItemLink code={i.itemCode} showCode /></td>
                <td className="px-3 py-2 max-w-[240px]"><ItemLink code={i.itemCode} name={i.itemName} /></td>
                <td className="px-3 py-2 text-end tabular-nums">{formatNumber(i.purchasedQty)}</td>
                <td className="px-3 py-2 text-end tabular-nums">{i.avgMonthlySales || '—'}</td>
                <td className="px-3 py-2 text-end tabular-nums">
                  {i.stockQty == null ? '—' : formatNumber(i.stockQty)}
                </td>
                <td className="px-3 py-2 text-end tabular-nums">
                  {i.coverMonths == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : i.coverMonths < 1 ? (
                    <span className="text-amber-500 font-semibold">{i.coverMonths}</span>
                  ) : (
                    i.coverMonths
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums whitespace-nowrap">{formatDate(i.lastOrder)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
