'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { useLocale } from '@/lib/locale-context'
import { formatNumber, formatCurrency } from '@/lib/constants'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ItemLink } from '@/components/shared/ItemLink'
import { Search } from 'lucide-react'
import { formatDate } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'

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
  // Subscribe to the demo-mode eye: formatCurrency() masks from a module
  // store, so without this the amounts here would not re-render on toggle.
  useMoneyHidden()

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

  const columns: DataTableColumn<DemandItem>[] = [
    {
      key: 'itemCode',
      header: t('suppliers.itemCode'),
      sortable: true,
      cell: i => <ItemLink code={i.itemCode} showCode />,
      exportValue: i => i.itemCode,
    },
    {
      key: 'itemName',
      header: t('suppliers.itemName'),
      sortable: true,
      truncate: 'max-w-[240px]',
      title: i => i.itemName,
      cell: i => <ItemLink code={i.itemCode} name={i.itemName} />,
      exportValue: i => i.itemName,
    },
    {
      key: 'purchasedQty',
      header: t('suppliers.bought'),
      align: 'end',
      sortable: true,
      cell: i => formatNumber(i.purchasedQty),
      exportValue: i => i.purchasedQty,
    },
    {
      key: 'avgMonthlySales',
      header: t('suppliers.soldPerMonth'),
      align: 'end',
      sortable: true,
      cell: i => i.avgMonthlySales || '—',
      exportValue: i => i.avgMonthlySales,
    },
    {
      key: 'stockQty',
      header: t('suppliers.stock'),
      align: 'end',
      sortable: true,
      // Unknown stock sorts below zero — see the note on cover below; the two
      // are different answers and must not collapse into one another.
      sortValue: i => i.stockQty ?? -1,
      cell: i => (i.stockQty == null ? '—' : formatNumber(i.stockQty)),
      exportValue: i => i.stockQty ?? '',
    },
    {
      key: 'coverMonths',
      header: <span title={t('suppliers.coverHint')}>{t('suppliers.cover')}</span>,
      exportHeader: t('suppliers.cover'),
      align: 'end',
      sortable: true,
      // "—" means NO SALES HISTORY, not "plenty of cover". Sorting it as
      // Infinity keeps it out of the running-out end of the list, which is the
      // end this column is read from.
      sortValue: i => i.coverMonths ?? Infinity,
      cell: i =>
        i.coverMonths == null ? (
          <span className="text-muted-foreground">—</span>
        ) : i.coverMonths < 1 ? (
          <span className="font-semibold text-amber-500">{i.coverMonths}</span>
        ) : (
          i.coverMonths
        ),
      exportValue: i => i.coverMonths ?? '',
    },
    {
      key: 'lastOrder',
      header: t('suppliers.lastOrder'),
      sortable: true,
      sortValue: i => i.lastOrder ?? '',
      cell: i => <span className="whitespace-nowrap">{formatDate(i.lastOrder)}</span>,
      exportValue: i => i.lastOrder ?? '',
    },
  ]

  return (
    <div className="space-y-3">
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: t('suppliers.itemsBought'), value: formatNumber(summary.items) },
            { label: t('suppliers.totalSpend'), value: formatCurrency(summary.totalSpend) },
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
          {formatNumber(filtered.length)} / {formatNumber(items.length)}
        </span>
      </div>

      <DataTable<DemandItem>
        rows={filtered}
        columns={columns}
        getRowKey={i => i.itemCode}
        loading={isLoading}
        defaultSort={{ field: 'purchasedQty', dir: 'desc' }}
        pageSize={50}
        minWidth="min-w-[720px]"
        exportFileName={`ביקוש-ספק-${code}`}
        labels={{
          loading: t('suppliers.loadingDemand'),
          empty: t('suppliers.noDemand'),
        }}
        mobileCard={{
          title: i => i.itemName || i.itemCode,
          subtitle: i => i.itemCode,
          accent: i => formatNumber(i.purchasedQty),
          fields: [
            { label: t('suppliers.stock'), value: i => (i.stockQty == null ? '—' : formatNumber(i.stockQty)) },
            { label: t('suppliers.cover'), value: i => i.coverMonths ?? '—' },
          ],
        }}
      />
    </div>
  )
}
