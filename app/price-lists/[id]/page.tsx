'use client'

/**
 * One price list: what is in it, and what changed since the previous version.
 *
 * The four change tiles are the reason to open this page — a supplier's monthly
 * list lands with a few hundred moves buried in half a million unchanged rows,
 * and the tiles are the only way to see them. Clicking one opens the rows behind
 * it, filtered by how big the move was.
 */

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { ArrowLeft, ClipboardList, Crown, Minus, Plus, Search, TrendingDown, TrendingUp, X } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { ItemLink } from '@/components/shared/ItemLink'
import { formatCurrency, formatNumber } from '@/lib/format'
import { useLocale } from '@/lib/locale-context'
import { XpartLink } from '@/components/xpart/XpartLink'
import { xpartUrl } from '@/lib/xpart-links'
import type { Provenance } from '@/lib/provenance'

interface Detail {
  price_list_id: string
  name: string
  version: number | null
  currency: string
  status: string
  is_promotional: boolean
  total_items: number | null
  effective_date: string | null
  expiry_date: string | null
  supplier_name: string | null
  supplier_role: string | null
  fx_rate: number | null
  changes: { increase: number; decrease: number; new: number; discontinued: number }
  provenance: Provenance
}

interface Item {
  part_number: string
  brand_name: string | null
  description_he: string | null
  description_en: string | null
  price: number
  currency: string
  cost_ils: number | null
  retail_ils: number | null
  margin_pct: number | null
  availability_status: string | null
  lead_time_days: number | null
}

interface Change {
  part_number: string
  brand_name: string | null
  description_he: string | null
  description_en: string | null
  old_price: number | null
  new_price: number | null
  change_type: string
  change_percentage: number | null
}

type ItemSort = 'part_number' | 'brand_name' | 'price' | 'cost_ils'
type ChangeType = 'increase' | 'decrease' | 'new' | 'discontinued'

const PAGE = 50
const MIN_PCT_CHOICES = [0, 5, 10, 25, 50]

function marginTone(pct: number | null): string {
  if (pct == null) return 'text-muted-foreground'
  if (pct >= 80) return 'text-emerald-600 dark:text-emerald-400'
  if (pct >= 60) return 'text-blue-600 dark:text-blue-400'
  if (pct >= 40) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

export default function PriceListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { locale } = useLocale()
  const isHe = locale === 'he'

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sort, setSort] = useState<{ field: ItemSort; dir: 'asc' | 'desc' }>({
    field: 'part_number',
    dir: 'asc',
  })
  const [offset, setOffset] = useState(0)
  const [changeType, setChangeType] = useState<ChangeType | null>(null)
  const [minPct, setMinPct] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400)
    return () => clearTimeout(t)
  }, [search])

  const { data: detail } = useQuery<Detail>({
    queryKey: ['xpart-price-list', id],
    queryFn: async () => {
      const res = await fetch(`/api/xpart/price-lists/${id}`)
      if (!res.ok) throw new Error('price list unavailable')
      return res.json()
    },
    staleTime: 30 * 60 * 1000,
  })

  const items = useQuery<{ items: Item[]; provenance: Provenance }>({
    queryKey: ['xpart-price-list-items', id, debouncedSearch, sort.field, sort.dir, offset],
    queryFn: async () => {
      const p = new URLSearchParams({
        sort: sort.field,
        dir: sort.dir,
        limit: String(PAGE),
        offset: String(offset),
      })
      if (debouncedSearch) p.set('q', debouncedSearch)
      const res = await fetch(`/api/xpart/price-lists/${id}/items?${p}`)
      if (!res.ok) throw new Error('items unavailable')
      return res.json()
    },
    staleTime: 15 * 60 * 1000,
    placeholderData: keepPreviousData,
  })

  const changes = useQuery<{ changes: Change[] }>({
    queryKey: ['xpart-price-changes', id, changeType, minPct],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: '300', min: String(minPct) })
      if (changeType) p.set('type', changeType)
      const res = await fetch(`/api/xpart/price-lists/${id}/changes?${p}`)
      if (!res.ok) throw new Error('changes unavailable')
      return res.json()
    },
    enabled: !!changeType,
    staleTime: 15 * 60 * 1000,
  })

  const itemColumns: DataTableColumn<Item, ItemSort>[] = [
    {
      key: 'part_number',
      header: isHe ? 'מק״ט' : 'Part',
      sortable: true,
      cell: i => <ItemLink code={i.part_number} showCode copyable={false} />,
      exportValue: i => i.part_number,
    },
    {
      key: 'brand_name',
      header: isHe ? 'מותג' : 'Brand',
      sortable: true,
      hideOnMobile: true,
      cell: i => i.brand_name ?? '—',
    },
    {
      key: 'description_he',
      header: isHe ? 'תיאור' : 'Description (HE)',
      truncate: 'max-w-[200px]',
      title: i => i.description_he ?? '',
      cell: i => <span dir="rtl">{i.description_he ?? '—'}</span>,
    },
    {
      key: 'description_en',
      header: isHe ? 'תיאור (אנגלית)' : 'Description (EN)',
      truncate: 'max-w-[200px]',
      hideOnMobile: true,
      title: i => i.description_en ?? '',
      cell: i => <span dir="ltr">{i.description_en ?? '—'}</span>,
    },
    {
      key: 'price',
      header: isHe ? 'מחיר' : 'Price',
      align: 'end',
      sortable: true,
      cell: i => `${formatNumber(i.price)} ${i.currency}`,
      exportValue: i => i.price,
    },
    {
      key: 'cost_ils',
      header: isHe ? 'עלות ₪' : 'Cost ₪',
      align: 'end',
      sortable: true,
      cell: i => (i.cost_ils == null ? '—' : formatCurrency(i.cost_ils)),
      exportValue: i => i.cost_ils,
    },
    {
      key: 'retail_ils',
      header: isHe ? 'קמעונאי ₪' : 'Retail ₪',
      align: 'end',
      hideOnMobile: true,
      cell: i => (i.retail_ils == null ? '—' : formatCurrency(i.retail_ils)),
      exportValue: i => i.retail_ils,
    },
    {
      key: 'margin_pct',
      header: isHe ? 'רווח' : 'Margin',
      align: 'end',
      cell: i => (
        <span className={marginTone(i.margin_pct)}>
          {i.margin_pct == null ? '—' : `${i.margin_pct.toFixed(1)}%`}
        </span>
      ),
      exportValue: i => i.margin_pct,
    },
  ]

  const changeColumns: DataTableColumn<Change>[] = [
    {
      key: 'part_number',
      header: isHe ? 'מק״ט' : 'Part',
      sortable: true,
      cell: c => <ItemLink code={c.part_number} showCode copyable={false} />,
      exportValue: c => c.part_number,
    },
    {
      key: 'description_en',
      header: isHe ? 'תיאור' : 'Description',
      truncate: 'max-w-[220px]',
      title: c => c.description_en ?? c.description_he ?? '',
      cell: c => <span dir="auto">{c.description_he || c.description_en || '—'}</span>,
    },
    {
      key: 'old_price',
      header: isHe ? 'מחיר קודם' : 'Old',
      align: 'end',
      sortable: true,
      cell: c => (c.old_price == null ? '—' : formatNumber(c.old_price)),
      exportValue: c => c.old_price,
    },
    {
      key: 'new_price',
      header: isHe ? 'מחיר חדש' : 'New',
      align: 'end',
      sortable: true,
      cell: c => (c.new_price == null ? '—' : formatNumber(c.new_price)),
      exportValue: c => c.new_price,
    },
    {
      key: 'change_percentage',
      header: isHe ? 'שינוי' : 'Change',
      align: 'end',
      sortable: true,
      cell: c =>
        c.change_percentage == null ? (
          '—'
        ) : (
          <span className={c.change_percentage > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>
            {c.change_percentage > 0 ? '+' : ''}
            {c.change_percentage.toFixed(1)}%
          </span>
        ),
      exportValue: c => c.change_percentage,
    },
  ]

  const tiles: Array<{ type: ChangeType; label: string; n: number; icon: typeof Plus; tone: string }> = [
    { type: 'increase', label: isHe ? 'התייקרויות' : 'Increases', n: detail?.changes.increase ?? 0, icon: TrendingUp, tone: 'text-red-500' },
    { type: 'decrease', label: isHe ? 'הוזלות' : 'Decreases', n: detail?.changes.decrease ?? 0, icon: TrendingDown, tone: 'text-emerald-500' },
    { type: 'new', label: isHe ? 'פריטים חדשים' : 'New items', n: detail?.changes.new ?? 0, icon: Plus, tone: 'text-blue-500' },
    { type: 'discontinued', label: isHe ? 'הופסקו' : 'Discontinued', n: detail?.changes.discontinued ?? 0, icon: Minus, tone: 'text-muted-foreground' },
  ]

  const shownFrom = offset + 1
  const shownTo = offset + (items.data?.items.length ?? 0)

  return (
    <div className="space-y-4 md:space-y-6">
      <Link href="/price-lists" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        {isHe ? 'חזרה למחירונים' : 'Back to price lists'}
      </Link>

      <PageHeader
        icon={ClipboardList}
        title={detail?.name ?? '…'}
        description={
          detail
            ? [
                detail.supplier_name,
                `v${detail.version ?? 1}`,
                detail.currency,
                detail.effective_date,
                detail.total_items != null
                  ? isHe
                    ? `${formatNumber(detail.total_items)} פריטים`
                    : `${formatNumber(detail.total_items)} items`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        provenance={detail?.provenance}
        actions={
          <div className="flex items-center gap-2">
            {detail?.supplier_role === 'official_distributor' && (
              <Badge variant="outline" className="gap-1">
                <Crown className="h-3 w-3 text-amber-500" />
                {isHe ? 'מחירון קמעונאי' : 'retail list'}
              </Badge>
            )}
            {detail?.is_promotional && <Badge variant="outline">{isHe ? 'מבצע' : 'promo'}</Badge>}
            <XpartLink href={xpartUrl.priceList(id)} label={isHe ? 'פתח ב‑Xpart' : 'Open in Xpart'} />
          </div>
        }
      />

      {detail && detail.currency !== 'ILS' && detail.fx_rate && (
        <p className="text-xs text-muted-foreground">
          {isHe
            ? `העלויות מחושבות לפי שער ${detail.currency}/₪ ${detail.fx_rate.toFixed(4)} · מחיר ספק × מקדם יבוא × שער`
            : `Costs use ${detail.currency}/ILS ${detail.fx_rate.toFixed(4)} · supplier price × import markup × rate`}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map(t => (
          <button
            key={t.type}
            type="button"
            disabled={t.n === 0}
            onClick={() => {
              setChangeType(t.type)
              setMinPct(0)
            }}
            className="text-start disabled:cursor-default disabled:opacity-60"
          >
            <Card className={t.n > 0 ? 'transition-colors hover:border-primary/50' : ''}>
              <CardContent className="p-4">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <t.icon className={`h-3.5 w-3.5 ${t.tone}`} />
                  {t.label}
                </div>
                <div className="text-2xl font-bold tabular-nums">{formatNumber(t.n)}</div>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      {changeType && (
        <Card>
          <CardContent className="space-y-3 p-3 sm:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                {tiles.find(t => t.type === changeType)?.label}
              </span>
              {(changeType === 'increase' || changeType === 'decrease') && (
                <div className="flex items-center gap-1">
                  {MIN_PCT_CHOICES.map(p => (
                    <Button
                      key={p}
                      size="sm"
                      variant={minPct === p ? 'default' : 'outline'}
                      onClick={() => setMinPct(p)}
                    >
                      {p === 0 ? (isHe ? 'הכל' : 'All') : `≥${p}%`}
                    </Button>
                  ))}
                </div>
              )}
              <Button size="sm" variant="ghost" className="ms-auto" onClick={() => setChangeType(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            {/* The cap is stated rather than silent: a list can hold 414k moves
                and showing 300 without saying so reads as "that is all of them". */}
            <p className="text-xs text-muted-foreground">
              {isHe
                ? `מוצגים עד 300 השינויים הגדולים ביותר מתוך ${formatNumber(detail?.changes[changeType] ?? 0)}`
                : `Showing the 300 largest of ${formatNumber(detail?.changes[changeType] ?? 0)} changes`}
            </p>
            <DataTable
              rows={changes.data?.changes ?? []}
              columns={changeColumns}
              getRowKey={c => `${c.part_number}|${c.change_type}`}
              loading={changes.isLoading}
              error={changes.isError ? (isHe ? 'לא ניתן לטעון שינויים' : 'Could not load changes') : undefined}
              onRetry={() => changes.refetch()}
              minWidth="min-w-[640px]"
              pageSize={50}
              exportFileName={`${detail?.name ?? 'price-list'}-${changeType}`}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-3 p-3 sm:p-4">
          <div className="relative max-w-xs">
            <Search className="absolute top-2.5 start-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => {
                setSearch(e.target.value)
                setOffset(0)
              }}
              placeholder={isHe ? 'חיפוש מק״ט…' : 'Search part number…'}
              className="ps-8"
            />
          </div>

          <DataTable
            rows={items.data?.items ?? []}
            columns={itemColumns}
            getRowKey={i => `${i.brand_name ?? ''}|${i.part_number}`}
            loading={items.isLoading}
            error={items.isError ? (isHe ? 'לא ניתן לטעון פריטים' : 'Could not load items') : undefined}
            onRetry={() => items.refetch()}
            sort={sort}
            onSortChange={next => {
              setSort(next as { field: ItemSort; dir: 'asc' | 'desc' })
              setOffset(0)
            }}
            minWidth="min-w-[900px]"
            labels={{ empty: isHe ? 'אין פריטים' : 'No items' }}
            footer={() =>
              detail?.total_items
                ? isHe
                  ? `מוצגים ${formatNumber(shownFrom)}–${formatNumber(shownTo)} מתוך ${formatNumber(detail.total_items)}`
                  : `Showing ${formatNumber(shownFrom)}–${formatNumber(shownTo)} of ${formatNumber(detail.total_items)}`
                : null
            }
          />

          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE))}>
              {isHe ? 'הקודם' : 'Previous'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={(items.data?.items.length ?? 0) < PAGE}
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
