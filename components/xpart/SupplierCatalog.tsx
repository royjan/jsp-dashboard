'use client'

/**
 * A supplier's priced catalog, from Xpart's price lists.
 *
 * The page this sits on used to show only an upload form over an empty
 * supplier_price_uploads table — while Xpart already held tens of thousands of
 * live prices for the same supplier. This is that catalog.
 *
 * Two comparisons carry the screen: margin against Lubinski's retail, and
 * whether another supplier quotes the same part for less. Sorting by the latter
 * is the "are we buying from the expensive one" question.
 *
 * Sort, search and paging are server-side over the whole catalog; the table is
 * controlled and deliberately does not re-sort locally, which would silently
 * re-rank just the loaded page.
 */

import { useEffect, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Search, TrendingDown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { StatGrid, StatTile } from '@/components/shared/StatTile'
import { FreshnessChip } from '@/components/shared/FreshnessChip'
import { ItemLink } from '@/components/shared/ItemLink'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { Provenance } from '@/lib/provenance'

interface CatalogRow {
  item_code: string
  item_name: string | null
  price: number
  currency: string
  landed_ils: number | null
  retail_ils: number | null
  margin_pct: number | null
  best_other_ils: number | null
  best_other_supplier: string | null
  cheaper_elsewhere_ils: number | null
  price_list_name: string | null
  effective_date: string | null
}

interface Response {
  linked: boolean
  rows: CatalogRow[]
  total: number
  summary: {
    items: number
    withRetail: number
    avgMarginPct: number | null
    cheaperElsewhere: number
    overpayIls: number
  } | null
  provenance: Provenance
}

type SortKey = 'item_code' | 'price' | 'landed_ils' | 'retail_ils' | 'margin_pct' | 'cheaper_elsewhere_ils'

const PAGE = 100

function marginTone(pct: number | null): string {
  if (pct == null) return 'text-muted-foreground'
  if (pct >= 80) return 'text-emerald-600 dark:text-emerald-400'
  if (pct >= 60) return 'text-blue-600 dark:text-blue-400'
  if (pct >= 40) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

export function SupplierCatalog({ supplierCode, isHe }: { supplierCode: string; isHe: boolean }) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ field: SortKey; dir: 'asc' | 'desc' }>({
    field: 'cheaper_elsewhere_ils',
    dir: 'desc',
  })
  const [onlyCheaper, setOnlyCheaper] = useState(false)
  const [offset, setOffset] = useState(0)
  // Same shape /stock-forecast uses — a timer, not a hook, because the repo has none.
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => clearTimeout(id)
  }, [search])

  const { data, isLoading, isError, refetch } = useQuery<Response>({
    queryKey: ['xpart-supplier-catalog', supplierCode, debouncedSearch, sort.field, sort.dir, onlyCheaper, offset],
    queryFn: async () => {
      const params = new URLSearchParams({
        sort: sort.field,
        dir: sort.dir,
        limit: String(PAGE),
        offset: String(offset),
      })
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (onlyCheaper) params.set('cheaper', '1')
      const res = await fetch(`/api/xpart/prices/supplier/${encodeURIComponent(supplierCode)}?${params}`)
      if (!res.ok) throw new Error('catalog unavailable')
      return res.json()
    },
    staleTime: 30 * 60 * 1000,
    placeholderData: keepPreviousData,
  })

  if (data && !data.linked) return null

  const columns: DataTableColumn<CatalogRow, SortKey>[] = [
    {
      key: 'item_code',
      header: isHe ? 'מק״ט' : 'Item',
      sortable: true,
      cell: r => <ItemLink code={r.item_code} showCode copyable={false} />,
      exportValue: r => r.item_code,
    },
    {
      key: 'item_name',
      header: isHe ? 'תיאור' : 'Description',
      truncate: 'max-w-[240px]',
      title: r => r.item_name ?? '',
      cell: r => <span dir="auto">{r.item_name ?? '—'}</span>,
    },
    {
      key: 'price',
      header: isHe ? 'מחיר ספק' : 'Their price',
      align: 'end',
      sortable: true,
      cell: r => `${formatNumber(r.price)} ${r.currency}`,
      exportValue: r => r.price,
    },
    {
      key: 'landed_ils',
      header: isHe ? 'עלות נחיתה ₪' : 'Landed ₪',
      align: 'end',
      sortable: true,
      cell: r => (r.landed_ils == null ? '—' : formatCurrency(r.landed_ils)),
      exportValue: r => r.landed_ils,
    },
    {
      key: 'retail_ils',
      header: isHe ? 'קמעונאי ₪' : 'Retail ₪',
      align: 'end',
      sortable: true,
      hideOnMobile: true,
      cell: r => (r.retail_ils == null ? '—' : formatCurrency(r.retail_ils)),
      exportValue: r => r.retail_ils,
    },
    {
      key: 'margin_pct',
      header: isHe ? 'רווח' : 'Margin',
      align: 'end',
      sortable: true,
      cell: r => (
        <span className={marginTone(r.margin_pct)}>
          {r.margin_pct == null ? '—' : `${r.margin_pct.toFixed(1)}%`}
        </span>
      ),
      exportValue: r => r.margin_pct,
    },
    {
      key: 'cheaper_elsewhere_ils',
      header: isHe ? 'זול יותר אצל' : 'Cheaper at',
      align: 'end',
      sortable: true,
      cell: r =>
        r.cheaper_elsewhere_ils == null ? (
          <span className="text-xs text-muted-foreground">{isHe ? 'הזול ביותר' : 'cheapest'}</span>
        ) : (
          <span className="text-amber-600 dark:text-amber-400">
            {r.best_other_supplier} · −{formatCurrency(r.cheaper_elsewhere_ils)}
          </span>
        ),
      exportValue: r => r.cheaper_elsewhere_ils,
      exportHeader: isHe ? 'חיסכון אפשרי ₪' : 'Possible saving ILS',
    },
  ]

  const shownFrom = data?.total ? offset + 1 : 0
  const shownTo = Math.min(offset + PAGE, data?.total ?? 0)

  return (
    <div className="space-y-4">
      {data?.summary && (
        <StatGrid columns={4}>
          <StatTile
            label={isHe ? 'פריטים מתומחרים' : 'Priced items'}
            value={formatNumber(data.summary.items)}
            index={0}
          />
          <StatTile
            label={isHe ? 'רווח ממוצע' : 'Avg. margin'}
            value={data.summary.avgMarginPct == null ? '—' : `${data.summary.avgMarginPct.toFixed(1)}%`}
            tone="info"
            index={1}
          />
          <StatTile
            label={isHe ? 'זול יותר אצל ספק אחר' : 'Cheaper elsewhere'}
            value={formatNumber(data.summary.cheaperElsewhere)}
            tone={data.summary.cheaperElsewhere > 0 ? 'warn' : 'good'}
            icon={TrendingDown}
            index={2}
          />
          <StatTile
            label={isHe ? 'פער מצטבר על פני הקטלוג' : 'Catalogue-wide gap'}
            value={formatCurrency(data.summary.overpayIls)}
            // Deliberately not "what we lost": this sums one unit of every part
            // in the list, including parts we have never bought. It is the size
            // of the question, not a bill.
            hint={
              isHe
                ? 'סכום ההפרש ליחידה אחת מכל פריט שספק אחר מתמחר בזול — לא נתון רכש בפועל'
                : 'Sum of the per-unit gap on every part another supplier prices lower — not actual spend'
            }
            index={3}
          />
        </StatGrid>
      )}

      <Card>
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute top-2.5 start-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => {
                  setSearch(e.target.value)
                  setOffset(0)
                }}
                placeholder={isHe ? 'חיפוש מק״ט…' : 'Search item code…'}
                className="ps-8"
              />
            </div>
            <Button
              variant={onlyCheaper ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setOnlyCheaper(v => !v)
                setOffset(0)
              }}
            >
              {isHe ? 'רק כאלה שזולים אצל אחר' : 'Only cheaper elsewhere'}
            </Button>
            {data?.provenance && <FreshnessChip provenance={data.provenance} />}
          </div>

          <DataTable
            rows={data?.rows ?? []}
            columns={columns}
            getRowKey={r => r.item_code}
            loading={isLoading}
            error={isError ? (isHe ? 'לא ניתן לטעון את המחירון' : 'Could not load the catalogue') : undefined}
            onRetry={() => refetch()}
            sort={sort}
            onSortChange={next => {
              setSort(next as { field: SortKey; dir: 'asc' | 'desc' })
              setOffset(0)
            }}
            minWidth="min-w-[820px]"
            labels={{
              empty: isHe ? 'אין פריטים מתומחרים לספק זה' : 'No priced items for this supplier',
            }}
            footer={() =>
              data?.total
                ? isHe
                  ? `מוצגים ${formatNumber(shownFrom)}–${formatNumber(shownTo)} מתוך ${formatNumber(data.total)}`
                  : `Showing ${formatNumber(shownFrom)}–${formatNumber(shownTo)} of ${formatNumber(data.total)}`
                : null
            }
          />

          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(o => Math.max(0, o - PAGE))}
            >
              {isHe ? 'הקודם' : 'Previous'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!data || offset + PAGE >= data.total}
              onClick={() => setOffset(o => o + PAGE)}
            >
              {isHe ? 'הבא' : 'Next'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
