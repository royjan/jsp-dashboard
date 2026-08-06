'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DataTable, type DataTableColumn, type DataTableSort } from '@/components/shared/DataTable'
import { ItemLink } from '@/components/shared/ItemLink'
import { CompetitorUploader } from '@/components/competitors/CompetitorUploader'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCompetitorComparison, useCompetitorItemHistory } from '@/hooks/use-competitors'
import { useLocale } from '@/lib/locale-context'
import { formatCurrency, formatNumber } from '@/lib/constants'
import { fixRtlItemName } from '@/lib/rtl-fix'
import { cn } from '@/lib/utils'
import { deriveBrand, brandChipClasses, BRAND_RANK } from '@/lib/brand'
import { Swords, Upload, PackageX, TrendingDown, SearchX, Search, ChevronLeft, ChevronRight, AlertTriangle, X } from 'lucide-react'
import type { CompareRow, CompetitorCell } from '@/app/api/analytics/competitors/route'
import type { TranslationKey } from '@/lib/i18n'

type SortField = 'code' | 'ourPrice' | 'ourStock' | 'minNet' | 'spread' | 'sold'
type T = (k: TranslationKey) => string

const PER_PAGE = 7

type StockFilter = 'in' | 'low' | 'out'
type PriceFilter = 'them' | 'us'
type OrigFilter = 'genuine' | 'aftermarket'

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
const looseCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(ORG|DIN|SOE|PEU|TYE)(?=[A-Z0-9]{4,})/, '')

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

/**
 * A text box backed by a query-string param.
 *
 * Typing stays local and updates the URL on a debounce, so a keystroke is not a
 * history entry and filtering still feels instant. The reverse direction matters
 * just as much: when the URL changes underneath us — Back/Forward, "clear
 * filters", a pasted link — the box adopts that value instead of racing to
 * overwrite it, which is what a one-way effect does.
 */
function useUrlTextInput(urlValue: string, commit: (v: string | null) => void) {
  const [value, setValue] = useState(urlValue)
  const pushed = useRef(urlValue)
  useEffect(() => {
    if (urlValue !== pushed.current) {
      pushed.current = urlValue
      setValue(urlValue)
      return
    }
    if (value === urlValue) return
    const id = setTimeout(() => {
      pushed.current = value
      commit(value || null)
    }, 350)
    return () => clearTimeout(id)
  }, [value, urlValue, commit])
  return [value, setValue] as const
}

/**
 * A labelled segmented control — one row of mutually exclusive choices where
 * `null` is the unfiltered default. Real <button>s, so it tabs and fires on
 * Enter/Space for free; styling is logical-property only so it mirrors in RTL.
 */
function Segmented<V extends string>({
  label, value, options, onChange,
}: {
  label: string
  value: V | null
  options: Array<{ value: V | null; label: string; title?: string }>
  onChange: (v: V | null) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="inline-flex rounded-md border p-0.5">
        {options.map(o => {
          const on = value === o.value
          return (
            <button
              key={o.value ?? '_all'}
              type="button"
              title={o.title}
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              className={cn(
                'rounded px-2 py-1 text-xs transition-colors',
                on ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CompetitorsPageInner() {
  const { t } = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // The URL IS the request: every filter the API understands is a query param,
  // so the address bar and the fetch can't drift apart. `per` pins the page size.
  const apiParams = useMemo(() => {
    const p = new URLSearchParams(searchParams.toString())
    p.set('per', String(PER_PAGE))
    return p.toString()
  }, [searchParams])
  const { data, isLoading, error, refetch } = useCompetitorComparison(apiParams)

  const [showUploader, setShowUploader] = useState(false)
  const [historyRow, setHistoryRow] = useState<CompareRow | null>(null)

  /**
   * The whole view lives in the query string — search, competitor selection,
   * every toggle, sort and page — so any state of this table can be linked,
   * bookmarked and reloaded. Writing a filter always drops ?page, since the
   * old page number means nothing against a different result set.
   */
  const setParams = useCallback((updates: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    if (!keepPage) next.delete('page')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname, searchParams])

  const flag = (key: string) => searchParams.get(key) === '1'
  const compParam = searchParams.get('comp')
  const activeCompetitors = useMemo(
    () => (compParam === null ? null : new Set(compParam.split(',').filter(Boolean))),
    [compParam],
  )
  const onlyWeAreOut = flag('they_stock')
  const showUnmatched = searchParams.get('view') === 'unmatched'

  const oneOf = <V extends string>(key: string, allowed: readonly V[]): V | null => {
    const v = searchParams.get(key)
    return allowed.includes(v as V) ? (v as V) : null
  }

  const stockFilter: StockFilter | null = oneOf('stock', ['in', 'low', 'out'] as const)
  const brandParam = searchParams.get('brand')
  const brandFilter = useMemo(
    () => (brandParam ? new Set(brandParam.split(',').filter(Boolean)) : null),
    [brandParam],
  )

  // `cheaper=1` and `genuine=1` were the first shipped form of these two
  // filters. They now have a direction, but old links must keep resolving —
  // the legacy flag is read as the value it used to mean.
  const priceFilter: PriceFilter | null =
    oneOf('price', ['them', 'us'] as const) ?? (flag('cheaper') ? 'them' : null)
  const origFilter: OrigFilter | null =
    oneOf('orig', ['genuine', 'aftermarket'] as const) ?? (flag('genuine') ? 'genuine' : null)

  // Spread threshold, read as an absolute percentage: |spread| >= gap.
  const gapParam = searchParams.get('gap')
  const minGap = gapParam !== null && gapParam !== '' && Number.isFinite(Number(gapParam))
    ? Math.abs(Number(gapParam))
    : null
  const sortField = (searchParams.get('sort') as SortField) || 'spread'
  const sortDir = searchParams.get('dir') === 'desc' ? 'desc' : 'asc'
  const sort = useMemo<DataTableSort<SortField>>(() => ({ field: sortField, dir: sortDir }), [sortField, sortDir])
  const page = Math.max(0, (Number(searchParams.get('page')) || 1) - 1)
  const goToPage = useCallback((p: number) => {
    setParams({ page: p <= 0 ? null : String(p + 1) }, true)
  }, [setParams])

  // The search box stays local so typing is instant; the URL catches up on a
  // short debounce rather than replacing history on every keystroke.
  const commitQuery = useCallback((v: string | null) => setParams({ q: v }), [setParams])
  const [search, setSearch] = useUrlTextInput(searchParams.get('q') ?? '', commitQuery)

  const commitGap = useCallback((v: string | null) => setParams({ gap: v }), [setParams])
  const [gapInput, setGapInput] = useUrlTextInput(searchParams.get('gap') ?? '', commitGap)

  const competitorNames = useMemo(() => data?.competitors.map(c => c.name) ?? [], [data])
  const enabled = useMemo(
    () => activeCompetitors ?? new Set(competitorNames),
    [activeCompetitors, competitorNames],
  )

  // The API already filtered, sorted and sliced — these are exactly the rows
  // for this page of this view.
  const pageRows = data?.rows ?? []
  const unmatchedPage = data?.unmatched ?? []

  // Brands that actually occur across the whole dataset, in resolution order.
  const availableBrands = useMemo(
    () => (data?.brands ?? []).slice().sort((a, b) => (BRAND_RANK[a] ?? 99) - (BRAND_RANK[b] ?? 99)),
    [data],
  )

  // Counted per view, so the badge never advertises a filter this view ignores.
  const activeFilterCount = (showUnmatched
    ? [search.trim() !== '', !!compParam, !!origFilter]
    : [
      search.trim() !== '', !!compParam, !!brandFilter, !!stockFilter,
      !!priceFilter, minGap !== null, !!origFilter, onlyWeAreOut,
    ]
  ).filter(Boolean).length

  const clearFilters = useCallback(() => {
    setSearch('')
    setGapInput('')
    setParams({
      q: null, comp: null, brand: null, stock: null, gap: null,
      price: null, cheaper: null, orig: null, genuine: null, they_stock: null,
    })
  }, [setParams, setSearch, setGapInput])

  // Totals and the effective page come back with the data, already clamped to
  // whichever list this view is showing.
  const activeCount = data?.total ?? 0
  const activePageCount = Math.max(1, Math.ceil(activeCount / PER_PAGE))
  const safePage = data ? data.page : Math.min(page, activePageCount - 1)

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
        // The brand rides inline with the code rather than claiming a column of
        // its own — this table already carries one column per competitor.
        cell: r => {
          const brand = deriveBrand(r.code)
          return (
            <span className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
              <ItemLink code={r.code} showCode />
              <span className={cn('shrink-0 rounded px-1 py-px text-[10px] font-medium leading-tight', brandChipClasses(brand))}>
                {brand}
              </span>
            </span>
          )
        },
      },
      {
        key: 'name',
        header: t('suppliers.itemName'),
        title: r => r.name,
        // max-width on a <td> is ignored under auto table layout, so the clamp
        // has to live on a block-level child — otherwise one long Hebrew name
        // stretches the column and pushes the table past its container.
        cell: r => (
          <span className="flex max-w-[240px] items-center gap-1">
            {r.warnings.length > 0 && (
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label={r.warnings.join('; ')} />
            )}
            <span className="truncate" title={r.name}>{fixRtlItemName(r.name)}</span>
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
        header: (
          <span className="flex flex-col items-center leading-tight">
            <span>{t('competitors.weWin')}</span>
            <span className="text-[10px] font-normal text-muted-foreground">{t('competitors.janPriceLabel')}</span>
          </span>
        ),
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
        header: (
          <span className="flex flex-col items-center leading-tight">
            <span>{name}</span>
            <span className="text-[10px] font-normal text-muted-foreground">{t('competitors.netLabel')}</span>
          </span>
        ),
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
          <p className="text-xs text-muted-foreground/70">{t('competitors.subtitle2')}</p>
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
          {/* Each of the three actionable KPIs is also the filter that isolates it. */}
          <Card
            role="button"
            tabIndex={0}
            onClick={() => setParams({ they_stock: onlyWeAreOut ? null : '1', view: null })}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setParams({ they_stock: onlyWeAreOut ? null : '1', view: null }) } }}
            className={cn(
              'cursor-pointer transition-colors hover:bg-muted/40',
              data.kpis.theyStockWeDont > 0 && 'border-destructive/50',
              onlyWeAreOut && 'ring-2 ring-destructive',
            )}
          >
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
          <Card
            role="button"
            tabIndex={0}
            onClick={() => setParams({ price: priceFilter === 'them' ? null : 'them', cheaper: null, view: null })}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setParams({ price: priceFilter === 'them' ? null : 'them', cheaper: null, view: null }) } }}
            className={cn(
              'cursor-pointer transition-colors hover:bg-muted/40',
              priceFilter === 'them' && 'ring-2 ring-primary',
            )}
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <TrendingDown className="h-3.5 w-3.5" />
                {t('competitors.cheaperThanUs')}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{formatNumber(data.kpis.cheaperThanUs)}</div>
            </CardContent>
          </Card>
          <Card
            role="button"
            tabIndex={0}
            onClick={() => setParams({ view: showUnmatched ? null : 'unmatched' })}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setParams({ view: showUnmatched ? null : 'unmatched' }) } }}
            className={cn(
              'cursor-pointer transition-colors hover:bg-muted/40',
              showUnmatched && 'ring-2 ring-primary',
            )}
          >
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

      {/* Filters — every control writes the query string, so the view is linkable. */}
      {hasData && (
        <div className="space-y-2.5 rounded-lg border bg-card/50 p-3">
          {/* Search · who we're comparing against · result count */}
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
            <span className="text-[11px] text-muted-foreground">{t('competitors.competitor')}</span>
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
                    // all selected == no filter, so drop the param entirely
                    const all = next.size === competitorNames.length
                    setParams({ comp: all ? null : [...next].join(',') })
                  }}
                >
                  {name}
                </Button>
              )
            })}
            <div className="ms-auto flex items-center gap-2">
              {activeFilterCount > 0 && (
                <>
                  <Badge variant="secondary" className="tabular-nums">
                    {activeFilterCount} {t('competitors.filtersActive')}
                  </Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={clearFilters}
                  >
                    <X className="h-3 w-3 me-1" />
                    {t('competitors.clearFilters')}
                  </Button>
                </>
              )}
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatNumber(activeCount)} {t('competitors.results')}
              </span>
            </div>
          </div>

          {/* Attribute filters. The Jan-side ones are meaningless against the
              unmatched list (those rows have no Jan item), so they're hidden there. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {!showUnmatched && (
              <Segmented<StockFilter>
                label={t('competitors.ourStock')}
                value={stockFilter}
                onChange={v => setParams({ stock: v })}
                options={[
                  { value: null, label: t('competitors.all') },
                  { value: 'in', label: t('competitors.inStock') },
                  { value: 'low', label: t('competitors.lowStock'), title: t('competitors.lowStockTitle') },
                  { value: 'out', label: t('competitors.outOfStock') },
                ]}
              />
            )}

            {!showUnmatched && (
              <Segmented<PriceFilter>
                label={t('competitors.priceVs')}
                value={priceFilter}
                // clear the legacy flag too, or it would resurrect the old filter
                onChange={v => setParams({ price: v, cheaper: null })}
                options={[
                  { value: null, label: t('competitors.all') },
                  { value: 'them', label: t('competitors.theyCheaper') },
                  { value: 'us', label: t('competitors.weCheaper') },
                ]}
              />
            )}

            {!showUnmatched && (
              <div className="flex items-center gap-1.5" title={t('competitors.minGapTitle')}>
                <span className="text-[11px] text-muted-foreground">{t('competitors.minGap')}</span>
                <Input
                  type="number"
                  min={0}
                  max={999}
                  inputMode="numeric"
                  value={gapInput}
                  onChange={e => setGapInput(e.target.value)}
                  placeholder="0"
                  className="h-8 w-16 text-xs"
                />
                <span className="text-[11px] text-muted-foreground">%</span>
              </div>
            )}

            <Segmented<OrigFilter>
              label={t('competitors.original')}
              value={origFilter}
              onChange={v => setParams({ orig: v, genuine: null })}
              options={[
                { value: null, label: t('competitors.all') },
                { value: 'genuine', label: t('competitors.genuine') },
                { value: 'aftermarket', label: t('competitors.aftermarket') },
              ]}
            />

            {!showUnmatched && availableBrands.length > 1 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground">{t('competitors.brand')}</span>
                {availableBrands.map(b => {
                  const on = !brandFilter || brandFilter.has(b)
                  return (
                    <button
                      key={b}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const current = brandFilter ?? new Set(availableBrands)
                        const next = new Set(current)
                        if (next.has(b)) next.delete(b)
                        else next.add(b)
                        const all = next.size === availableBrands.length
                        setParams({ brand: all || next.size === 0 ? null : [...next].join(',') })
                      }}
                      className={cn(
                        'rounded px-1.5 py-1 text-[11px] font-medium transition-opacity',
                        brandChipClasses(b),
                        on ? '' : 'opacity-40',
                      )}
                    >
                      {b}
                    </button>
                  )
                })}
              </div>
            )}

            {!showUnmatched && (
              <Button
                size="sm"
                variant={onlyWeAreOut ? 'destructive' : 'outline'}
                onClick={() => setParams({ they_stock: onlyWeAreOut ? null : '1' })}
              >
                <PackageX className="h-3.5 w-3.5 me-1" />
                {t('competitors.onlyWeAreOut')}
              </Button>
            )}

            <Button
              size="sm"
              variant={showUnmatched ? 'secondary' : 'outline'}
              className="ms-auto"
              onClick={() => setParams({ view: showUnmatched ? null : 'unmatched' })}
            >
              <SearchX className="h-3.5 w-3.5 me-1" />
              {t('competitors.showUnmatched')}
            </Button>
          </div>
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
              onSortChange={s => setParams({ sort: s.field, dir: s.dir })}
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
                { key: 'name', header: t('suppliers.itemName'), cell: r => <span className="block max-w-[320px] truncate" title={r.name ?? undefined}>{r.name ? fixRtlItemName(r.name) : '—'}</span> },
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
          {/* dir="ltr" isolates these composites: under RTL, BiDi reorders the
              runs around the separators and "1–7 / 19" reads back as "19 / 7–1". */}
          <span dir="ltr" className="text-xs tabular-nums text-muted-foreground">
            {formatNumber(safePage * PER_PAGE + 1)}–{formatNumber(Math.min((safePage + 1) * PER_PAGE, activeCount))}
            {' / '}{formatNumber(activeCount)}
          </span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" disabled={safePage === 0} onClick={() => goToPage(0)}>«</Button>
            <Button size="sm" variant="outline" disabled={safePage === 0} onClick={() => goToPage(safePage - 1)}>
              <ChevronRight className="h-4 w-4 rtl:rotate-0 ltr:hidden" />
              <ChevronLeft className="hidden h-4 w-4 ltr:block" />
            </Button>
            <span dir="ltr" className="px-2 text-xs tabular-nums text-muted-foreground">
              {safePage + 1} / {activePageCount}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={safePage >= activePageCount - 1}
              onClick={() => goToPage(safePage + 1)}
            >
              <ChevronLeft className="h-4 w-4 ltr:hidden" />
              <ChevronRight className="hidden h-4 w-4 ltr:block" />
            </Button>
            <Button size="sm" variant="outline" disabled={safePage >= activePageCount - 1} onClick={() => goToPage(activePageCount - 1)}>»</Button>
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

export default function CompetitorsPage() {
  // useSearchParams (via useUrlParams) needs a Suspense boundary to prerender.
  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground">טוען…</div>}>
      <CompetitorsPageInner />
    </Suspense>
  )
}
