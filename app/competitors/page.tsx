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
import { Swords, Upload, PackageX, TrendingDown, SearchX, Search, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'
import type { CompareRow, CompetitorCell } from '@/app/api/analytics/competitors/route'
import type { TranslationKey } from '@/lib/i18n'

type SortField = 'code' | 'ourPrice' | 'ourStock' | 'minNet' | 'spread' | 'sold'
type T = (k: TranslationKey) => string

const PER_PAGE = 50

/** Whole shekels stay clean; agorot are shown when they exist (71.16 ≠ 71). */
function money(v: number | null | undefined): string {
  if (v == null) return '—'
  return formatCurrency(v, Number.isInteger(v) ? 0 : 2)
}

function StockPill({ qty, status, t }: { qty: number | null; status: string; t: T }) {
  if (status === 'in_stock') {
    return <Badge variant="success">{qty != null ? formatNumber(qty) : t('competitors.inStock')}</Badge>
  }
  if (status === 'out_of_stock') {
    return <Badge variant="destructive">{qty != null ? formatNumber(qty) : t('competitors.outOfStock')}</Badge>
  }
  return <span className="text-xs text-muted-foreground">—</span>
}

/** Codes compared the way the importer normalises them, minus the xlsx import. */
const looseCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(DIN|ORG)(?=[A-Z0-9]{4,})/, '')

/** One price-over-stock cell — used identically for Jan and every competitor. */
function PriceStockCell({
  price, qty, status, highlight, crossRef, rawCode, janCode, t,
}: {
  price: number | null
  qty: number | null
  status: string
  highlight?: boolean
  crossRef?: boolean
  rawCode?: string
  janCode?: string
  t: T
}) {
  // They list this part under a different number (our supersession chain, or an
  // OEM cross-reference) — show it, so every price on screen is traceable.
  const otherCode = rawCode && janCode && looseCode(rawCode) !== looseCode(janCode) ? rawCode : null
  return (
    <div
      className={`flex flex-col items-center gap-0.5 ${crossRef ? 'opacity-60' : ''}`}
      title={crossRef ? `${t('competitors.crossRefTooltip')} ${rawCode ?? ''}` : rawCode}
    >
      <span className={highlight ? 'font-semibold text-emerald-600 dark:text-emerald-400' : undefined}>
        {crossRef && <span className="me-0.5 text-muted-foreground">≈</span>}
        {money(price)}
      </span>
      <StockPill qty={qty} status={status} t={t} />
      {otherCode && <span className="font-mono text-[10px] text-muted-foreground">{otherCode}</span>}
    </div>
  )
}

function GenuineBadge({ value, t }: { value: string; t: T }) {
  if (value === 'genuine') return <Badge variant="success">{t('competitors.genuine')}</Badge>
  if (value === 'aftermarket') return <Badge variant="secondary">{t('competitors.aftermarket')}</Badge>
  return <span className="text-xs text-muted-foreground">—</span>
}

export default function CompetitorsPage() {
  const { t } = useLocale()
  const { data, isLoading, error, refetch } = useCompetitorComparison()

  const [search, setSearch] = useState('')
  const [activeCompetitors, setActiveCompetitors] = useState<Set<string> | null>(null)
  const [onlyTheyBeatUs, setOnlyTheyBeatUs] = useState(false)
  const [onlyWeAreOut, setOnlyWeAreOut] = useState(false)
  const [onlyGenuine, setOnlyGenuine] = useState(false)
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [showUploader, setShowUploader] = useState(false)
  const [sort, setSort] = useState<DataTableSort<SortField>>({ field: 'spread', dir: 'asc' })
  const [historyRow, setHistoryRow] = useState<CompareRow | null>(null)
  const [page, setPage] = useState(0)

  const competitorNames = useMemo(() => data?.competitors.map(c => c.name) ?? [], [data])
  const enabled = useMemo(
    () => activeCompetitors ?? new Set(competitorNames),
    [activeCompetitors, competitorNames],
  )

  const rows = useMemo(() => {
    if (!data) return []
    const q = search.trim().toUpperCase()
    const filtered = data.rows.filter(r => {
      if (q && !r.code.toUpperCase().includes(q) && !r.name.toUpperCase().includes(q)) return false
      if (!Object.keys(r.competitors).some(n => enabled.has(n))) return false
      if (onlyTheyBeatUs && !r.flags.cheaperThanUs) return false
      if (onlyWeAreOut && !r.flags.theyStockWeDont) return false
      if (onlyGenuine && r.genuineness !== 'genuine') return false
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
    return [...filtered].sort((a, b) => {
      const va = val(a); const vb = val(b)
      if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb)) * dirMul
      return (va - (vb as number)) * dirMul
    })
  }, [data, search, enabled, onlyTheyBeatUs, onlyWeAreOut, onlyGenuine, sort])

  // Any change to what's listed sends you back to the first page (adjusted
  // during render rather than in an effect, so there's no second paint).
  const filterKey = JSON.stringify([search, [...enabled].sort(), onlyTheyBeatUs, onlyWeAreOut, onlyGenuine, sort, showUnmatched])
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey)
    setPage(0)
  }

  const pageCount = Math.max(1, Math.ceil(rows.length / PER_PAGE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = useMemo(
    () => rows.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE),
    [rows, safePage],
  )

  const historyCodes = useMemo(() => {
    if (!historyRow) return null
    return [...new Set(Object.values(historyRow.competitors).map(c => c.itemCode))]
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
        truncate: 'max-w-[220px]',
        title: r => r.name,
        cell: r => (
          <span className="flex items-center gap-1">
            {r.warnings.length > 0 && (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label={r.warnings.join('; ')} />
            )}
            {fixRtlItemName(r.name)}
          </span>
        ),
      },
      {
        key: 'genuine',
        header: t('competitors.original'),
        align: 'center',
        hideOnMobile: true,
        cell: r => <GenuineBadge value={r.genuineness} t={t} />,
      },
      // Jan reads exactly like a competitor column: price over stock.
      {
        key: 'jan',
        header: t('competitors.weWin'),
        align: 'center',
        sortable: true,
        sortKey: 'ourPrice',
        headerClassName: 'text-primary',
        cell: r => (
          <PriceStockCell
            price={r.ourPrice}
            qty={r.ourStock}
            status={r.ourStock > 0 ? 'in_stock' : 'out_of_stock'}
            highlight={r.cheapestCompetitor === 'Jan'}
            t={t}
          />
        ),
      },
    ]

    for (const name of competitorNames) {
      cols.push({
        key: `comp-${name}`,
        header: name,
        align: 'center',
        cell: r => {
          const cell: CompetitorCell | undefined = r.competitors[name]
          if (!cell) return <span className="text-muted-foreground">—</span>
          return (
            <PriceStockCell
              price={cell.netPrice}
              qty={cell.stockQty}
              status={cell.stockStatus}
              highlight={!cell.crossRef && r.cheapestCompetitor === name}
              crossRef={cell.crossRef}
              rawCode={cell.rawCode}
              janCode={r.code}
              t={t}
            />
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
  const unmatchedRows = useMemo(() => {
    if (!data) return []
    const q = search.trim().toUpperCase()
    return data.unmatched.filter(r => {
      if (q && !r.itemCode.includes(q) && !(r.name || '').toUpperCase().includes(q)) return false
      return r.competitors.some(n => enabled.has(n))
    })
  }, [data, search, enabled])
  const unmatchedPage = unmatchedRows.slice(safePage * PER_PAGE, safePage * PER_PAGE + PER_PAGE)
  const activeCount = showUnmatched ? unmatchedRows.length : rows.length
  const activePageCount = Math.max(1, Math.ceil(activeCount / PER_PAGE))

  return (
    <div className="w-full min-w-0 space-y-4">
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
            <Search className="pointer-events-none absolute top-2.5 start-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('competitors.searchPlaceholder')}
              className="w-56 ps-9"
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
          <Button size="sm" variant={onlyGenuine ? 'secondary' : 'outline'} onClick={() => setOnlyGenuine(v => !v)}>
            {t('competitors.onlyGenuine')}
          </Button>
          <Button size="sm" variant={showUnmatched ? 'secondary' : 'outline'} onClick={() => setShowUnmatched(v => !v)}>
            <SearchX className="h-3.5 w-3.5 me-1" />
            {t('competitors.showUnmatched')}
          </Button>
        </div>
      )}

      {/* Main comparison table */}
      {!showUnmatched && (
        <Card className="w-full min-w-0 overflow-hidden">
          <CardContent className="p-3">
            <DataTable<CompareRow, SortField>
              columns={columns}
              rows={pageRows}
              getRowKey={r => r.code}
              loading={isLoading}
              error={error}
              onRetry={() => refetch()}
              sort={sort}
              onSortChange={setSort}
              onRowClick={r => setHistoryRow(r)}
              rowClassName={r => (r.flags.theyStockWeDont ? 'bg-destructive/5' : undefined)}
              minWidth="min-w-[980px]"
              maxHeight="65vh"
              // the vertical scrollbar sits on the inline-end side and would
              // otherwise sit on top of the last column's digits
              className="pe-4"
              labels={{ empty: t('competitors.noData') }}
            />
          </CardContent>
        </Card>
      )}

      {/* Unmatched competitor items (catalog intel) */}
      {showUnmatched && data && (
        <Card className="w-full min-w-0 overflow-hidden">
          <CardContent className="p-3">
            <DataTable
              columns={[
                { key: 'code', header: t('suppliers.itemCode'), cell: (r: (typeof data.unmatched)[number]) => <span className="font-mono">{r.rawCode}</span> },
                { key: 'name', header: t('suppliers.itemName'), truncate: 'max-w-[320px]', title: r => r.name ?? undefined, cell: r => (r.name ? fixRtlItemName(r.name) : '—') },
                { key: 'genuine', header: t('competitors.original'), align: 'center', cell: r => <GenuineBadge value={r.genuineness} t={t} /> },
                { key: 'net', header: t('competitors.net'), align: 'end', cell: r => money(r.netPrice) },
                { key: 'stock', header: t('competitors.stock'), align: 'center', cell: r => <StockPill qty={null} status={r.stockStatus} t={t} /> },
                { key: 'competitors', header: t('competitors'), cell: r => r.competitors.join(', ') },
              ]}
              rows={unmatchedPage}
              getRowKey={r => r.itemCode}
              minWidth="min-w-[760px]"
              maxHeight="65vh"
              // the vertical scrollbar sits on the inline-end side and would
              // otherwise sit on top of the last column's digits
              className="pe-4"
            />
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {hasData && activeCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-xs text-muted-foreground">
            {formatNumber(safePage * PER_PAGE + 1)}–{formatNumber(Math.min((safePage + 1) * PER_PAGE, activeCount))}
            {' / '}{formatNumber(activeCount)}
          </span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" disabled={safePage === 0} onClick={() => setPage(0)}>«</Button>
            <Button size="sm" variant="outline" disabled={safePage === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
              <ChevronRight className="h-4 w-4 rtl:rotate-0 ltr:hidden" />
              <ChevronLeft className="hidden h-4 w-4 ltr:block" />
            </Button>
            <span className="px-2 text-xs tabular-nums text-muted-foreground">
              {safePage + 1} / {activePageCount}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={safePage >= activePageCount - 1}
              onClick={() => setPage(p => Math.min(activePageCount - 1, p + 1))}
            >
              <ChevronLeft className="h-4 w-4 ltr:hidden" />
              <ChevronRight className="hidden h-4 w-4 ltr:block" />
            </Button>
            <Button size="sm" variant="outline" disabled={safePage >= activePageCount - 1} onClick={() => setPage(activePageCount - 1)}>»</Button>
          </div>
        </div>
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
              {historyRow.warnings.length > 0 && (
                <div className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span>{historyRow.warnings.join(' · ')}</span>
                </div>
              )}
              {(history?.series ?? []).map((s: { competitor: string; points: Array<{ uploadedAt: string; netPrice: number | null; stockQty: number | null; stockStatus: string }> }) => (
                <div key={s.competitor}>
                  <div className="mb-1 font-medium">{s.competitor}</div>
                  <div className="overflow-hidden rounded border">
                    <table className="w-full text-xs">
                      <tbody>
                        {s.points.map((p, i) => (
                          <tr key={i} className="border-b last:border-b-0">
                            <td className="px-2 py-1">{new Date(p.uploadedAt).toLocaleDateString('he-IL')}</td>
                            <td className="px-2 py-1 text-end tabular-nums">{money(p.netPrice)}</td>
                            <td className="px-2 py-1 text-center"><StockPill qty={p.stockQty} status={p.stockStatus} t={t} /></td>
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
