'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import * as XLSX from 'xlsx'
import {
  Car, Download, PackageX, Search, TrendingUp, X, Layers, Loader2,
} from 'lucide-react'
import { useLocale } from '@/lib/locale-context'
import { useCatalogGap, useCatalogGapProjects } from '@/hooks/use-catalog-gap'
import type { CatalogGapPart, CatalogGapResponse, CatalogGapVehicle } from '@/app/api/analytics/catalog-gap/route'
import type { CatalogGapProject } from '@/app/api/analytics/catalog-gap/projects/route'
import { brandChipClasses } from '@/lib/brand'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/constants'
import { toast } from '@/lib/toast'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { ItemLink } from '@/components/shared/ItemLink'
import { SubTabs } from '@/components/shared/SubTabs'
import { Segmented, useUrlTextInput } from '@/components/shared/filter-controls'
import { PageHeader } from '@/components/shared/PageHeader'

const PAGE_SIZE = 50
const EXPORT_CAP = 5000
/** How many vehicle names ride inline in a row before "+N more". */
const INLINE_VEHICLES = 2
const BRANDS = ['PSA', 'MG', 'TOYOTA'] as const

type BrandFilter = (typeof BRANDS)[number]

/** "פיג׳ו 308 2024", falling back to the VIN tail when the gov.il lookup never landed. */
function vehicleLabel(v: CatalogGapVehicle): string {
  const parts = [v.make, v.model, v.year].filter(Boolean)
  return parts.length ? parts.join(' ') : v.vin.slice(-8)
}

/**
 * The ranking signal, drawn as well as printed. The bar is relative to the
 * heaviest row on screen, so the eye finds the stocking candidates without
 * reading a single number.
 */
function VehicleCount({ count, max }: { count: number; max: number }) {
  const pct = max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block">
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-semibold tabular-nums">{formatNumber(count)}</span>
    </div>
  )
}

function BrandChip({ brand }: { brand: string }) {
  return (
    <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', brandChipClasses(brand))}>
      {brand}
    </span>
  )
}

function VehiclesCell({ part, moreLabel, sampleNote }: {
  part: CatalogGapPart
  moreLabel: string
  sampleNote: string
}) {
  if (!part.vehicles.length) return <span className="text-muted-foreground">—</span>
  const shown = part.vehicles.slice(0, INLINE_VEHICLES)
  const hidden = part.vehicleCount - shown.length
  // `vehicles` is a capped sample, so the tooltip can list fewer than `hidden`.
  const sampled = part.vehicles.length < part.vehicleCount

  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map(v => (
        <span
          key={v.vin}
          title={v.vin}
          className="rounded border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground"
        >
          {vehicleLabel(v)}
        </span>
      ))}
      {hidden > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="rounded border border-dashed px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
            >
              {moreLabel} {formatNumber(hidden)}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" align="start" className="max-w-xs">
            <ul className="space-y-0.5">
              {part.vehicles.map(v => (
                <li key={v.vin} className="flex items-center gap-2">
                  <span>{vehicleLabel(v)}</span>
                  <span dir="ltr" className="font-mono text-[10px] opacity-70">{v.vin}</span>
                </li>
              ))}
            </ul>
            {sampled && <div className="mt-1 opacity-70">{sampleNote}</div>}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

function KpiCard({ label, value, hint, icon: Icon, tone, active, onClick }: {
  label: string
  value: string
  hint?: string
  icon: typeof PackageX
  tone?: 'destructive'
  active?: boolean
  onClick?: () => void
}) {
  const interactive = !!onClick
  return (
    <Card
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={interactive ? e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick!() }
      } : undefined}
      className={cn(
        interactive && 'cursor-pointer transition-colors hover:bg-muted/40',
        active && 'ring-2 ring-primary',
      )}
    >
      <CardContent className="p-4">
        <div className={cn('flex items-center gap-1.5 text-xs', tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground')}>
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        <div className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'destructive' && 'text-destructive')}>
          {value}
        </div>
        {hint && <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{hint}</div>}
      </CardContent>
    </Card>
  )
}

function CatalogGapPageInner() {
  const { t, locale } = useLocale()
  const isHe = locale === 'he'
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // --- filter state lives in the URL, so any filtered list is shareable ---
  const setParams = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname, searchParams])

  const q = searchParams.get('q') ?? ''
  const brandParam = searchParams.get('brand')
  const brand = BRANDS.includes(brandParam as BrandFilter) ? (brandParam as BrandFilter) : null
  const projectId = searchParams.get('projectId')
  // Absent === the actionable view. Only an explicit ?onlyOrphans=0 widens it,
  // which keeps the default URL clean AND the default filter the useful one.
  const onlyOrphans = searchParams.get('onlyOrphans') !== '0'

  const commitQuery = useCallback((v: string | null) => setParams({ q: v }), [setParams])
  const [search, setSearch] = useUrlTextInput(q, commitQuery)

  // The server sorts by vehicle_count DESC and LIMIT is nearly free once that
  // sort has run, so "load more" grows the window rather than paging by offset —
  // one cache entry, no offset drift when the catalog changes underneath.
  const [rowLimit, setRowLimit] = useState(PAGE_SIZE)
  const filterKey = `${q}|${brand}|${projectId}|${onlyOrphans}`
  useEffect(() => { setRowLimit(PAGE_SIZE) }, [filterKey])

  const apiParams = useMemo(() => {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (brand) p.set('brand', brand)
    if (projectId) p.set('projectId', projectId)
    if (!onlyOrphans) p.set('onlyOrphans', '0')
    p.set('limit', String(rowLimit))
    return p.toString()
  }, [q, brand, projectId, onlyOrphans, rowLimit])

  const { data, isLoading, isFetching, error, refetch } = useCatalogGap(apiParams)
  const { data: projectData } = useCatalogGapProjects()
  const projects: CatalogGapProject[] = projectData?.projects ?? []

  const rows = useMemo(() => data?.parts ?? [], [data])
  const maxCount = rows[0]?.vehicleCount ?? 0
  const noEquivalentCount = useMemo(
    () => rows.filter(r => !r.sellableEquivalent).length,
    [rows],
  )

  const activeFilterCount = [search.trim() !== '', !!brand, !!projectId, !onlyOrphans].filter(Boolean).length
  const clearFilters = useCallback(() => {
    setSearch('')
    setParams({ q: null, brand: null, projectId: null, onlyOrphans: null })
  }, [setParams, setSearch])

  // --- export: refetches the CURRENT filters unpaged, never just what's on screen ---
  const [exporting, setExporting] = useState(false)
  const exportToExcel = useCallback(async () => {
    setExporting(true)
    try {
      const p = new URLSearchParams(apiParams)
      p.set('limit', String(EXPORT_CAP))
      p.set('vehicles', '6')
      const res = await fetch(`/api/analytics/catalog-gap?${p.toString()}`)
      if (!res.ok) throw new Error(String(res.status))
      const body: CatalogGapResponse = await res.json()
      if (!body.parts.length) { toast.error(t('catalogGap.exportEmpty')); return }

      const sheetRows = body.parts.map((r, i) => ({
        '#': i + 1,
        [isHe ? 'מק״ט' : 'Part']: r.itemNumber,
        [isHe ? 'מותג' : 'Brand']: r.brand,
        [isHe ? 'תיאור עברית' : 'Description (HE)']: r.hebrewDescription ?? '',
        [isHe ? 'תיאור אנגלית' : 'Description (EN)']: r.description ?? '',
        [isHe ? 'מספר רכבים' : 'Vehicle Count']: r.vehicleCount,
        [isHe ? 'רכבים' : 'Vehicles']: r.vehicles
          .map(v => `${vehicleLabel(v)} (${v.vin})`)
          .join('; ') + (r.vehicles.length < r.vehicleCount ? ` … +${r.vehicleCount - r.vehicles.length}` : ''),
        [isHe ? 'תחליף נמכר' : 'Sellable Equivalent']: r.sellableEquivalent ?? '',
        [isHe ? 'מותג התחליף' : 'Equivalent Brand']: r.equivalentBrand ?? '',
      }))

      const ws = XLSX.utils.json_to_sheet(sheetRows)
      ws['!cols'] = [
        { wch: 5 }, { wch: 16 }, { wch: 8 }, { wch: 34 }, { wch: 34 },
        { wch: 12 }, { wch: 60 }, { wch: 18 }, { wch: 12 },
      ]
      if (isHe) ws['!dir'] = 'rtl'
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, isHe ? 'פערי קטלוג' : 'Catalog Gap')
      XLSX.writeFile(wb, `catalog-gap-${new Date().toISOString().split('T')[0]}.xlsx`)
      if (body.truncated) toast.error(t('catalogGap.exportTruncated'))
    } catch {
      toast.error(t('catalogGap.exportFailed'))
    } finally {
      setExporting(false)
    }
  }, [apiParams, isHe, t])

  // DataTable's cells carry no inline padding of their own, so adjacent columns
  // touch — which read as one word ("רכביםנסרק מ־") in the header. Every column
  // but the last pays its own gutter.
  const GUTTER = 'pe-4'

  const columns = useMemo<DataTableColumn<CatalogGapPart>[]>(() => [
    {
      key: 'part',
      header: t('catalogGap.colPart'),
      sortable: true,
      sortValue: r => r.itemNumber,
      cellClassName: cn('font-mono', GUTTER),
      headerClassName: GUTTER,
      cell: r => <ItemLink code={r.itemNumber} showCode />,
    },
    {
      key: 'brand',
      header: t('catalogGap.colBrand'),
      sortable: true,
      sortValue: r => r.brand ?? '',
      cellClassName: GUTTER,
      headerClassName: GUTTER,
      // The stored brand wins over deriveBrand(code): partly knows which catalog
      // the part actually came from, the prefix rule is only an inference.
      cell: r => <BrandChip brand={r.brand} />,
    },
    {
      key: 'description',
      header: t('catalogGap.colDescription'),
      sortable: true,
      sortValue: r => r.hebrewDescription ?? r.description ?? '',
      truncate: 'max-w-[280px]',
      cellClassName: GUTTER,
      headerClassName: GUTTER,
      title: r => r.hebrewDescription ?? r.description ?? '',
      cell: r => (r.hebrewDescription
        ? <span>{r.hebrewDescription}</span>
        : <span dir="ltr" className="inline-block text-start text-muted-foreground">{r.description ?? '—'}</span>),
    },
    {
      key: 'vehicleCount',
      header: t('catalogGap.colVehicleCount'),
      align: 'end',
      sortable: true,
      sortValue: r => r.vehicleCount,
      headerClassName: cn('text-foreground', GUTTER),
      cellClassName: GUTTER,
      cell: r => <VehicleCount count={r.vehicleCount} max={maxCount} />,
    },
    {
      key: 'vehicles',
      header: t('catalogGap.colVehicles'),
      sortable: true,
      sortValue: r => r.vehicleCount,
      cellClassName: cn('max-w-[300px]', GUTTER),
      headerClassName: GUTTER,
      cell: r => (
        <VehiclesCell part={r} moreLabel={t('catalogGap.andMore')} sampleNote={t('catalogGap.sampleOnly')} />
      ),
    },
    {
      key: 'equivalent',
      header: t('catalogGap.colEquivalent'),
      sortable: true,
      // Parts WITH a sellable equivalent sort together; the ones without —
      // the actionable gaps — stay findable at the other end.
      sortValue: r => r.sellableEquivalent ?? '',
      cell: r => (r.sellableEquivalent ? (
        <span className="inline-flex items-center gap-1.5">
          <ItemLink code={r.sellableEquivalent} showCode />
          {r.equivalentBrand && <BrandChip brand={r.equivalentBrand} />}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
          <PackageX className="h-3.5 w-3.5 shrink-0" />
          {t('catalogGap.noEquivalent')}
        </span>
      )),
    },
  ], [t, maxCount])

  const hasMore = !!data?.hasMore

  return (
    <TooltipProvider delayDuration={150}>
      <div className="w-full min-w-0 space-y-4">
        <PageHeader
          icon={PackageX}
          title={t('page.catalogGap')}
          description={t('catalogGap.subtitle')}
          provenance={data?.provenance}
          actions={
            <Button size="sm" onClick={exportToExcel} disabled={exporting || isLoading || !rows.length}>
              {exporting
                ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" />
                : <Download className="h-4 w-4 me-1.5" />}
              {exporting ? t('catalogGap.exporting') : t('catalogGap.export')}
            </Button>
          }
        >
          <p className="text-xs text-muted-foreground/70">{t('catalogGap.subtitle2')}</p>
        </PageHeader>

        <SubTabs
          tabs={[
            { href: '/gap', label: t('catalogGap.tabDemand') },
            { href: '/gap/catalog', label: t('catalogGap.tabCatalog') },
          ]}
        />

        {/* KPIs — counted over the loaded rows, never presented as a grand total. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard
            icon={Layers}
            label={t('catalogGap.kpiLoaded')}
            value={`${formatNumber(rows.length)}${hasMore ? '+' : ''}`}
            hint={t('catalogGap.kpiLoadedHint')}
          />
          <KpiCard
            icon={PackageX}
            tone="destructive"
            label={t('catalogGap.kpiNoEquivalent')}
            value={formatNumber(noEquivalentCount)}
            active={onlyOrphans}
            onClick={() => setParams({ onlyOrphans: onlyOrphans ? '0' : null })}
            hint={t('catalogGap.onlyOrphansTitle')}
          />
          <KpiCard
            icon={TrendingUp}
            label={t('catalogGap.kpiTopCount')}
            value={formatNumber(maxCount)}
            hint={rows[0]?.itemNumber}
          />
        </div>

        {/* Filters — every control writes the query string, so the view is linkable. */}
        <div className="space-y-2.5 rounded-lg border bg-card/50 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 start-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('catalogGap.searchPlaceholder')}
                className="w-56 ps-9"
                aria-label={t('catalogGap.searchPlaceholder')}
              />
            </div>

            <Segmented<BrandFilter>
              label={t('catalogGap.brand')}
              value={brand}
              onChange={v => setParams({ brand: v })}
              options={[
                { value: null, label: t('catalogGap.all') },
                ...BRANDS.map(b => ({ value: b, label: b })),
              ]}
            />

            <label className="flex items-center gap-1.5">
              <Car className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="sr-only">{t('catalogGap.vehicle')}</span>
              <select
                value={projectId ?? ''}
                onChange={e => setParams({ projectId: e.target.value || null })}
                className="h-9 max-w-[16rem] rounded-md border bg-background px-2 text-xs"
              >
                <option value="">{t('catalogGap.allVehicles')}</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>
                    {[p.make, p.model, p.year].filter(Boolean).join(' ') || p.vin} · {p.vin.slice(-6)} ({formatNumber(p.partCount)})
                  </option>
                ))}
              </select>
            </label>

            <div className="ms-auto flex items-center gap-2">
              {activeFilterCount > 0 && (
                <>
                  <Badge variant="secondary" className="tabular-nums">
                    {activeFilterCount} {t('catalogGap.filtersActive')}
                  </Badge>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={clearFilters}>
                    <X className="h-3 w-3 me-1" />
                    {t('catalogGap.clearFilters')}
                  </Button>
                </>
              )}
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatNumber(rows.length)}{hasMore ? '+' : ''} {t('catalogGap.rowsLoaded')}
              </span>
            </div>
          </div>

          <Segmented<'all'>
            label={t('catalogGap.scope')}
            value={onlyOrphans ? null : 'all'}
            onChange={v => setParams({ onlyOrphans: v === 'all' ? '0' : null })}
            options={[
              { value: null, label: t('catalogGap.onlyOrphans'), title: t('catalogGap.onlyOrphansTitle') },
              { value: 'all', label: t('catalogGap.showAll') },
            ]}
          />
        </div>

        {/* Table — wide content scrolls inside this card, never the page. */}
        <Card>
          <CardContent className="p-3 sm:p-4">
            <DataTable<CatalogGapPart>
              columns={columns}
              rows={rows}
              getRowKey={r => r.itemNumber}
              loading={isLoading}
              error={error}
              onRetry={() => refetch()}
              minWidth="min-w-[860px]"
              maxHeight="calc(100vh - 22rem)"
              defaultSort={{ field: 'vehicleCount', dir: 'desc' }}
              labels={{ empty: t('catalogGap.empty') }}
            />

            <div className="mt-3 flex items-center justify-center">
              {hasMore ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isFetching}
                  onClick={() => setRowLimit(n => n + PAGE_SIZE)}
                >
                  {isFetching && <Loader2 className="h-3.5 w-3.5 me-1.5 animate-spin" />}
                  {isFetching ? t('catalogGap.loadingMore') : t('catalogGap.loadMore')}
                </Button>
              ) : rows.length > 0 ? (
                <span className="text-xs text-muted-foreground">{t('catalogGap.allLoaded')}</span>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <p className="max-w-4xl text-xs text-muted-foreground/70">{t('catalogGap.methodology')}</p>
      </div>
    </TooltipProvider>
  )
}

export default function CatalogGapPage() {
  // useSearchParams needs a Suspense boundary to prerender.
  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground">טוען…</div>}>
      <CatalogGapPageInner />
    </Suspense>
  )
}
