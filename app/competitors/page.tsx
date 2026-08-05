'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DataTable, type DataTableColumn, type DataTableSort } from '@/components/shared/DataTable'
import { ItemLink } from '@/components/shared/ItemLink'
import { CompetitorUploader } from '@/components/competitors/CompetitorUploader'
import { useCompetitorComparison, useCompetitorItemHistory } from '@/hooks/use-competitors'
import { useLocale } from '@/lib/locale-context'
import { formatCurrency, formatNumber } from '@/lib/constants'
import { fixRtlItemName } from '@/lib/rtl-fix'
import { Swords, Upload, PackageX, TrendingDown, SearchX, Search } from 'lucide-react'
import type { CompareRow } from '@/app/api/analytics/competitors/route'
import type { TranslationKey } from '@/lib/i18n'

type SortField = 'code' | 'ourPrice' | 'ourStock' | 'minNet' | 'spread' | 'sold'

function StockBadge({ qty, status, t }: { qty: number | null; status: string; t: (k: TranslationKey) => string }) {
  if (status === 'in_stock') {
    return <Badge variant="success">{qty != null ? formatNumber(qty) : (t('competitors.inStock'))}</Badge>
  }
  if (status === 'out_of_stock') return <Badge variant="destructive">{t('competitors.outOfStock')}</Badge>
  return <span className="text-muted-foreground">—</span>
}

export default function CompetitorsPage() {
  const { t } = useLocale()
  const { data, isLoading, error, refetch } = useCompetitorComparison()

  const [search, setSearch] = useState('')
  const [activeCompetitors, setActiveCompetitors] = useState<Set<string> | null>(null)
  const [onlyTheyBeatUs, setOnlyTheyBeatUs] = useState(false)
  const [onlyWeAreOut, setOnlyWeAreOut] = useState(false)
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [showUploader, setShowUploader] = useState(false)
  const [sort, setSort] = useState<DataTableSort<SortField>>({ field: 'spread', dir: 'asc' })
  const [historyRow, setHistoryRow] = useState<CompareRow | null>(null)

  const competitorNames = useMemo(() => data?.competitors.map(c => c.name) ?? [], [data])
  const enabled = useMemo(
    () => activeCompetitors ?? new Set(competitorNames),
    [activeCompetitors, competitorNames],
  )

  const rows = useMemo(() => {
    if (!data) return []
    const q = search.trim().toUpperCase()
    let out = data.rows.filter(r => {
      if (q && !r.code.toUpperCase().includes(q) && !r.name.toUpperCase().includes(q)) return false
      const visibleCells = Object.keys(r.competitors).filter(n => enabled.has(n))
      if (!visibleCells.length) return false
      if (onlyTheyBeatUs && !r.flags.cheaperThanUs) return false
      if (onlyWeAreOut && !r.flags.theyStockWeDont) return false
      return true
    })
    const dirMul = sort.dir === 'asc' ? 1 : -1
    const val = (r: CompareRow): number | string => {
      switch (sort.field) {
        case 'code': return r.code
        case 'ourPrice': return r.ourPrice ?? -1
        case 'ourStock': return r.ourStock
        case 'minNet': return r.minCompetitorNet ?? -1
        case 'spread': return r.spreadPct ?? 999
        case 'sold': return r.soldThisYear
      }
    }
    out = [...out].sort((a, b) => {
      const va = val(a); const vb = val(b)
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * dirMul
      return (va - (vb as number)) * dirMul
    })
    return out
  }, [data, search, enabled, onlyTheyBeatUs, onlyWeAreOut, sort])

  const historyCodes = useMemo(() => {
    if (!historyRow) return null
    const codes = new Set<string>()
    for (const cell of Object.values(historyRow.competitors)) codes.add(cell.itemCode)
    return [...codes]
  }, [historyRow])
  const { data: history } = useCompetitorItemHistory(historyCodes)

  const columns = useMemo<DataTableColumn<CompareRow, SortField>[]>(() => {
    const cols: DataTableColumn<CompareRow, SortField>[] = [
      {
        key: 'code',
        header: t('suppliers.itemCode'),
        sortable: true,
        sortKey: 'code',
        cell: r => (
          <span onClick={e => e.stopPropagation()}>
            <ItemLink code={r.code} showCode />
          </span>
        ),
      },
      {
        key: 'name',
        header: t('suppliers.itemName'),
        truncate: 'max-w-[240px]',
        title: r => r.name,
        cell: r => fixRtlItemName(r.name),
      },
      {
        key: 'ourPrice',
        header: t('competitors.ourPrice'),
        align: 'end',
        sortable: true,
        sortKey: 'ourPrice',
        cell: r => (r.ourPrice != null ? formatCurrency(r.ourPrice) : '—'),
      },
      {
        key: 'ourStock',
        header: t('competitors.ourStock'),
        align: 'end',
        sortable: true,
        sortKey: 'ourStock',
        cell: r => (
          <span className={r.flags.theyStockWeDont ? 'text-destructive font-semibold' : undefined}>
            {formatNumber(r.ourStock)}
          </span>
        ),
      },
    ]

    for (const name of competitorNames) {
      cols.push({
        key: `comp-${name}`,
        header: name,
        align: 'center',
        cell: r => {
          const cell = r.competitors[name]
          if (!cell) return <span className="text-muted-foreground">—</span>
          const isCheapest = r.cheapestCompetitor === name
          return (
            <div className="flex flex-col items-center gap-0.5">
              <span className={isCheapest ? 'font-semibold text-emerald-600 dark:text-emerald-400' : undefined}>
                {cell.netPrice != null ? formatCurrency(cell.netPrice) : '—'}
              </span>
              <StockBadge qty={cell.stockQty} status={cell.stockStatus} t={t} />
            </div>
          )
        },
      })
    }

    cols.push(
      {
        key: 'cheapest',
        header: t('competitors.cheapest'),
        align: 'center',
        hideOnMobile: true,
        cell: r =>
          r.cheapestCompetitor ? (
            <Badge variant={r.cheapestCompetitor === 'Jan' ? 'success' : 'warning'}>{r.cheapestCompetitor}</Badge>
          ) : (
            '—'
          ),
      },
      {
        key: 'spread',
        header: t('competitors.spread'),
        align: 'end',
        sortable: true,
        sortKey: 'spread',
        cell: r =>
          r.spreadPct != null ? (
            <span className={r.spreadPct < 0 ? 'text-destructive font-medium' : 'text-emerald-600 dark:text-emerald-400'}>
              {r.spreadPct > 0 ? '+' : ''}{r.spreadPct}%
            </span>
          ) : (
            '—'
          ),
      },
      {
        key: 'sold',
        header: t('competitors.soldThisYear'),
        align: 'end',
        sortable: true,
        sortKey: 'sold',
        hideOnMobile: true,
        cell: r => formatNumber(r.soldThisYear),
      },
    )

    return cols
  }, [competitorNames, t])

  const hasData = !!data && data.competitors.length > 0

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Swords className="h-5 w-5 text-primary" />
            {t('competitors.title')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('competitors.subtitle')}</p>
        </div>
        <Button variant={showUploader ? 'secondary' : 'default'} size="sm" onClick={() => setShowUploader(v => !v)}>
          <Upload className="h-4 w-4 me-1.5" />
          {t('competitors.uploadFile')}
        </Button>
      </div>

      {(showUploader || (!hasData && !isLoading)) && <CompetitorUploader />}

      {/* KPI cards */}
      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">{t('competitors.matchedItems')}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.kpis.matchedItems)}</div>
            </CardContent>
          </Card>
          <Card className={data.kpis.theyStockWeDont > 0 ? 'border-destructive/50' : undefined}>
            <CardContent className="p-4">
              <div className="flex items-center gap-1 text-xs text-destructive">
                <PackageX className="h-3.5 w-3.5" />
                {t('competitors.theyStockWeDont')}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-destructive">
                {formatNumber(data.kpis.theyStockWeDont)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <TrendingDown className="h-3.5 w-3.5" />
                {t('competitors.cheaperThanUs')}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.kpis.cheaperThanUs)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <SearchX className="h-3.5 w-3.5" />
                {t('competitors.unmatched')}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {formatNumber(data.kpis.unmatchedCompetitorItems)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      {hasData && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute top-2.5 h-4 w-4 text-muted-foreground ms-2.5 start-0" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('competitors.searchPlaceholder')}
              className="w-56 ps-8"
            />
          </div>
          {competitorNames.map(name => {
            const on = enabled.has(name)
            return (
              <Button
                key={name}
                size="sm"
                variant={on ? 'secondary' : 'outline'}
                className={on ? '' : 'opacity-50'}
                onClick={() => {
                  const next = new Set(enabled)
                  if (on) next.delete(name)
                  else next.add(name)
                  setActiveCompetitors(next)
                }}
              >
                {name}
              </Button>
            )
          })}
          <Button size="sm" variant={onlyTheyBeatUs ? 'default' : 'outline'} onClick={() => setOnlyTheyBeatUs(v => !v)}>
            <TrendingDown className="h-3.5 w-3.5 me-1" />
            {t('competitors.onlyTheyBeatUs')}
          </Button>
          <Button size="sm" variant={onlyWeAreOut ? 'destructive' : 'outline'} onClick={() => setOnlyWeAreOut(v => !v)}>
            <PackageX className="h-3.5 w-3.5 me-1" />
            {t('competitors.onlyWeAreOut')}
          </Button>
          <Button size="sm" variant={showUnmatched ? 'secondary' : 'outline'} onClick={() => setShowUnmatched(v => !v)}>
            <SearchX className="h-3.5 w-3.5 me-1" />
            {t('competitors.showUnmatched')}
          </Button>
          <span className="text-xs text-muted-foreground ms-auto">{formatNumber(rows.length)} / {formatNumber(data?.rows.length ?? 0)}</span>
        </div>
      )}

      {/* Main comparison table */}
      {!showUnmatched && (
        <Card>
          <CardContent className="p-3">
            <DataTable<CompareRow, SortField>
              columns={columns}
              rows={rows}
              getRowKey={r => r.code}
              loading={isLoading}
              error={error}
              onRetry={() => refetch()}
              sort={sort}
              onSortChange={setSort}
              onRowClick={r => setHistoryRow(r)}
              rowClassName={r => (r.flags.theyStockWeDont ? 'bg-destructive/5' : undefined)}
              minWidth="min-w-[900px]"
              labels={{ empty: t('competitors.noData') }}
            />
          </CardContent>
        </Card>
      )}

      {/* Unmatched competitor items (catalog intel) */}
      {showUnmatched && data && (
        <Card>
          <CardContent className="p-3">
            <DataTable
              columns={[
                { key: 'code', header: t('suppliers.itemCode'), cell: (r: (typeof data.unmatched)[number]) => <span className="font-mono">{r.rawCode}</span> },
                { key: 'name', header: t('suppliers.itemName'), truncate: 'max-w-[320px]', title: r => r.name ?? undefined, cell: r => (r.name ? fixRtlItemName(r.name) : '—') },
                { key: 'net', header: 'נטו ₪', align: 'end', cell: r => (r.netPrice != null ? formatCurrency(r.netPrice) : '—') },
                { key: 'stock', header: t('competitors.inStock'), align: 'center', cell: r => <StockBadge qty={null} status={r.stockStatus} t={t} /> },
                { key: 'competitors', header: t('competitors'), cell: r => r.competitors.join(', ') },
              ]}
              rows={data.unmatched.filter(r => {
                const q = search.trim().toUpperCase()
                if (q && !r.itemCode.includes(q) && !(r.name || '').toUpperCase().includes(q)) return false
                return r.competitors.some(n => enabled.has(n))
              })}
              getRowKey={r => r.itemCode}
              minWidth="min-w-[700px]"
            />
          </CardContent>
        </Card>
      )}

      {/* Price history dialog */}
      <Dialog open={!!historyRow} onOpenChange={open => !open && setHistoryRow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {t('competitors.priceHistory')}
              {historyRow && <span className="font-mono text-sm text-muted-foreground">{historyRow.code}</span>}
            </DialogTitle>
          </DialogHeader>
          {historyRow && (
            <div className="space-y-3 text-sm">
              <div className="text-muted-foreground">{fixRtlItemName(historyRow.name)}</div>
              {(history?.series ?? []).map((s: { competitor: string; points: Array<{ uploadedAt: string; netPrice: number | null; stockQty: number | null; stockStatus: string }> }) => (
                <div key={s.competitor}>
                  <div className="mb-1 font-medium">{s.competitor}</div>
                  <div className="rounded border overflow-hidden">
                    <table className="w-full text-xs">
                      <tbody>
                        {s.points.map((p, i) => (
                          <tr key={i} className="border-b last:border-b-0">
                            <td className="px-2 py-1">{new Date(p.uploadedAt).toLocaleDateString('he-IL')}</td>
                            <td className="px-2 py-1 text-end tabular-nums">{p.netPrice != null ? formatCurrency(p.netPrice) : '—'}</td>
                            <td className="px-2 py-1 text-center"><StockBadge qty={p.stockQty} status={p.stockStatus} t={t} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
