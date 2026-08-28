'use client'

/**
 * One procurement round: the lines that went out, who quoted what, and the
 * comparison Xpart computed from it.
 *
 * The comparison grid is Xpart's own snapshot rendered as-is — see the API route
 * for why it is not recomputed here. Its age and freshness are shown next to it
 * rather than hidden, because a stale snapshot is still the number the buyer
 * worked from and pretending otherwise helps nobody.
 */

import { use, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, FileSearch } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { StatGrid, StatTile } from '@/components/shared/StatTile'
import { ItemLink } from '@/components/shared/ItemLink'
import { formatCurrency, formatNumber } from '@/lib/format'
import { useLocale } from '@/lib/locale-context'
import { XpartLink } from '@/components/xpart/XpartLink'
import { xpartUrl } from '@/lib/xpart-links'
import type { Provenance } from '@/lib/provenance'

interface Inquiry {
  inquiry_id: string
  inquiry_number: string
  status: string
  total_items: number | null
  customer_reference: string | null
  notes: string | null
  created_at: string
  finansit_doc_number: string | null
  created_by_name: string | null
  snapshot_status: string | null
  snapshot_computed_at: string | null
}

interface Coverage {
  supplier_name: string | null
  response_id: string
  source_label: string | null
  total_inquiry_items: number
  responded_items: number
  missing_items: number
  coverage_pct: number
}

interface Item {
  inquiry_item_id: string
  row_number: number | null
  brand_name: string | null
  part_number: string
  item_id: string | null
  description: string | null
  quantity: number | null
  reference_price: number | null
  quality_grade: string | null
}

/** Xpart's internal snapshot shape — every field treated as optional on purpose. */
interface SnapshotSupplier {
  columnKey: string
  displayName?: string
  supplierName?: string
  sourceType?: string
  itemsWithPrice?: number
  totalItems?: number
  totalCostIls?: number
  avgMarginPct?: number
}
interface SnapshotPrice {
  costIls?: number
  marginPct?: number
  unitPrice?: number
  currency?: string
}
interface SnapshotItem {
  inquiryItemId?: string
  rowNumber?: number
  partNumber?: string
  brandName?: string
  description?: string
  quantity?: number
  retailPriceIls?: number
  supplierPrices?: Record<string, SnapshotPrice>
  bestPriceSupplierId?: string
}

type Tab = 'items' | 'comparison'

export default function InquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { locale } = useLocale()
  const isHe = locale === 'he'
  const [tab, setTab] = useState<Tab>('items')

  const head = useQuery<{ inquiry: Inquiry; coverage: Coverage[]; provenance: Provenance }>({
    queryKey: ['xpart-inquiry', id],
    queryFn: async () => {
      const res = await fetch(`/api/xpart/inquiries/${id}`)
      if (!res.ok) throw new Error('inquiry unavailable')
      return res.json()
    },
    staleTime: 15 * 60 * 1000,
  })

  const items = useQuery<{ items: Item[] }>({
    queryKey: ['xpart-inquiry-items', id],
    queryFn: async () => {
      const res = await fetch(`/api/xpart/inquiries/${id}/items?limit=1000`)
      if (!res.ok) throw new Error('items unavailable')
      return res.json()
    },
    enabled: tab === 'items',
    staleTime: 15 * 60 * 1000,
  })

  const comparison = useQuery<{
    computed: boolean
    status?: string
    computedAt?: string
    payload?: { items?: SnapshotItem[]; suppliers?: SnapshotSupplier[] }
    provenance: Provenance
  }>({
    queryKey: ['xpart-inquiry-comparison', id],
    queryFn: async () => {
      const res = await fetch(`/api/xpart/inquiries/${id}/comparison`)
      if (!res.ok) throw new Error('comparison unavailable')
      return res.json()
    },
    enabled: tab === 'comparison',
    staleTime: 15 * 60 * 1000,
  })

  const inquiry = head.data?.inquiry

  // Xpart highlights two things on its own items table, and both matter here:
  // a part number quoted twice in the same round, and a line that never matched
  // the catalog. Duplicates are counted over the loaded set, which is the whole
  // inquiry — the API asks for 1,000 and no round is larger.
  const dupKeys = new Set<string>()
  const seen = new Set<string>()
  for (const it of items.data?.items ?? []) {
    const key = `${it.brand_name ?? ''}|${it.part_number}`
    if (seen.has(key)) dupKeys.add(key)
    seen.add(key)
  }

  const itemColumns: DataTableColumn<Item>[] = [
    { key: 'row_number', header: '#', align: 'end', sortable: true, cell: i => i.row_number ?? '—' },
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
      key: 'description',
      header: isHe ? 'תיאור' : 'Description',
      truncate: 'max-w-[260px]',
      title: i => i.description ?? '',
      cell: i => <span dir="auto">{i.description ?? '—'}</span>,
    },
    {
      key: 'quantity',
      header: isHe ? 'כמות' : 'Qty',
      align: 'end',
      sortable: true,
      cell: i => (i.quantity == null ? '—' : formatNumber(i.quantity)),
      exportValue: i => i.quantity,
    },
    {
      key: 'reference_price',
      header: isHe ? 'מחיר ייחוס' : 'Ref. price',
      align: 'end',
      sortable: true,
      cell: i => (i.reference_price == null ? '—' : formatCurrency(i.reference_price)),
      exportValue: i => i.reference_price,
    },
    {
      key: 'quality_grade',
      header: isHe ? 'איכות' : 'Quality',
      align: 'center',
      hideOnMobile: true,
      cell: i => i.quality_grade ?? '—',
    },
  ]

  const suppliers = comparison.data?.payload?.suppliers ?? []
  const snapshotItems = comparison.data?.payload?.items ?? []

  const comparisonColumns: DataTableColumn<SnapshotItem>[] = [
    { key: 'rowNumber', header: '#', align: 'end', sortable: true, cell: i => i.rowNumber ?? '—' },
    {
      key: 'partNumber',
      header: isHe ? 'מק״ט' : 'Part',
      sortable: true,
      cell: i => (i.partNumber ? <ItemLink code={i.partNumber} showCode copyable={false} /> : '—'),
      exportValue: i => i.partNumber ?? '',
    },
    {
      key: 'quantity',
      header: isHe ? 'כמות' : 'Qty',
      align: 'end',
      sortable: true,
      cell: i => (i.quantity == null ? '—' : formatNumber(i.quantity)),
      exportValue: i => i.quantity,
    },
    {
      key: 'retailPriceIls',
      header: isHe ? 'קמעונאי ₪' : 'Retail ₪',
      align: 'end',
      sortable: true,
      cell: i => (i.retailPriceIls == null ? '—' : formatCurrency(i.retailPriceIls)),
      exportValue: i => i.retailPriceIls,
    },
    // One column per supplier column-key, exactly as Xpart lays it out: a
    // supplier that answered twice (catalog + a quote) is two columns, which is
    // why the key is columnKey and not supplierId.
    ...suppliers.map<DataTableColumn<SnapshotItem>>(s => ({
      key: s.columnKey,
      header: s.displayName ?? s.supplierName ?? s.columnKey,
      align: 'end',
      sortable: true,
      sortValue: i => i.supplierPrices?.[s.columnKey]?.costIls ?? Infinity,
      cell: i => {
        const p = i.supplierPrices?.[s.columnKey]
        if (!p?.costIls) return <span className="text-muted-foreground">—</span>
        const isBest = i.bestPriceSupplierId === s.columnKey
        return (
          <span className={isBest ? 'font-semibold text-emerald-600 dark:text-emerald-400' : ''}>
            {formatCurrency(p.costIls)}
            {p.marginPct != null && (
              <span className="ms-1 text-[10px] text-muted-foreground">{p.marginPct.toFixed(0)}%</span>
            )}
          </span>
        )
      },
      exportValue: i => i.supplierPrices?.[s.columnKey]?.costIls ?? null,
      exportHeader: s.displayName ?? s.supplierName ?? s.columnKey,
    })),
  ]

  return (
    <div className="space-y-4 md:space-y-6">
      <Link
        href="/inquiries"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
        {isHe ? 'חזרה לפניות' : 'Back to inquiries'}
      </Link>

      <PageHeader
        icon={FileSearch}
        title={inquiry?.inquiry_number ?? '…'}
        description={
          inquiry
            ? [
                inquiry.status,
                inquiry.total_items != null
                  ? isHe
                    ? `${formatNumber(inquiry.total_items)} פריטים`
                    : `${formatNumber(inquiry.total_items)} items`
                  : null,
                inquiry.customer_reference,
                inquiry.finansit_doc_number ? `ERP ${inquiry.finansit_doc_number}` : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        provenance={head.data?.provenance}
        actions={<XpartLink href={xpartUrl.inquiry(id)} label={isHe ? 'פתח ב‑Xpart' : 'Open in Xpart'} />}
      />

      {(head.data?.coverage.length ?? 0) > 0 && (
        <StatGrid columns={Math.min(head.data!.coverage.length, 5) as 2 | 3 | 4 | 5}>
          {head.data!.coverage.map((c, i) => (
            <StatTile
              key={c.response_id}
              label={c.supplier_name ?? '—'}
              value={`${c.coverage_pct}%`}
              hint={
                isHe
                  ? `${formatNumber(c.responded_items)} מתוך ${formatNumber(c.total_inquiry_items)}`
                  : `${formatNumber(c.responded_items)} of ${formatNumber(c.total_inquiry_items)}`
              }
              tone={c.coverage_pct >= 80 ? 'good' : c.coverage_pct >= 40 ? 'warn' : 'bad'}
              index={i}
            />
          ))}
        </StatGrid>
      )}

      <div className="flex items-center gap-1 border-b">
        {(['items', 'comparison'] as Tab[]).map(k => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === k
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {k === 'items' ? (isHe ? 'פריטים' : 'Items') : isHe ? 'השוואת ספקים' : 'Comparison'}
          </button>
        ))}
      </div>

      {tab === 'items' && (
        <Card>
          <CardContent className="p-3 sm:p-4">
            <DataTable
              rows={items.data?.items ?? []}
              columns={itemColumns}
              getRowKey={i => i.inquiry_item_id}
              loading={items.isLoading}
              error={items.isError ? (isHe ? 'לא ניתן לטעון פריטים' : 'Could not load items') : undefined}
              onRetry={() => items.refetch()}
              defaultSort={{ field: 'row_number', dir: 'asc' }}
              exportFileName={`${inquiry?.inquiry_number ?? 'inquiry'}-items`}
              minWidth="min-w-[840px]"
              pageSize={50}
              rowClassName={i =>
                dupKeys.has(`${i.brand_name ?? ''}|${i.part_number}`)
                  ? 'bg-red-500/5'
                  : i.item_id === null
                    ? 'bg-amber-500/5'
                    : ''
              }
              labels={{ empty: isHe ? 'אין פריטים' : 'No items' }}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              {isHe
                ? 'רקע אדום — מק״ט שמופיע יותר מפעם אחת · רקע כתום — שורה שלא הותאמה לקטלוג'
                : 'Red — part appears more than once · Amber — line never matched the catalogue'}
            </p>
          </CardContent>
        </Card>
      )}

      {tab === 'comparison' && (
        <Card>
          <CardContent className="space-y-3 p-3 sm:p-4">
            {comparison.data && !comparison.data.computed ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {isHe
                  ? 'ההשוואה לא חושבה עדיין ב‑Xpart — אין מה להציג כאן.'
                  : 'Xpart has not computed this comparison yet — there is nothing to show.'}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">
                    {comparison.data?.status === 'fresh'
                      ? isHe
                        ? 'עדכני'
                        : 'fresh'
                      : (comparison.data?.status ?? '')}
                  </Badge>
                  {comparison.data?.computedAt && (
                    <span>
                      {isHe ? 'חושב ב־' : 'computed'} {comparison.data.computedAt.slice(0, 16).replace('T', ' ')}
                    </span>
                  )}
                  <span>
                    {isHe
                      ? 'הנתונים מחושבים ב‑Xpart ומוצגים כאן כפי שהם'
                      : 'Computed in Xpart, shown here as-is'}
                  </span>
                  <XpartLink
                    href={xpartUrl.comparison(id)}
                    label={isHe ? 'חשב מחדש ב‑Xpart' : 'Recompute in Xpart'}
                    className="ms-auto"
                  />
                </div>

                {suppliers.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                    {suppliers.map(s => (
                      <div key={s.columnKey} className="rounded-md border p-2">
                        <div className="truncate text-xs font-medium">{s.displayName ?? s.supplierName}</div>
                        <div className="text-sm font-semibold tabular-nums">
                          {s.totalCostIls == null ? '—' : formatCurrency(s.totalCostIls)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {formatNumber(s.itemsWithPrice ?? 0)}/{formatNumber(s.totalItems ?? 0)}
                          {s.avgMarginPct != null && ` · ${s.avgMarginPct.toFixed(0)}%`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <DataTable
                  rows={snapshotItems}
                  columns={comparisonColumns}
                  getRowKey={i => i.inquiryItemId ?? `${i.rowNumber}`}
                  loading={comparison.isLoading}
                  error={comparison.isError ? (isHe ? 'לא ניתן לטעון השוואה' : 'Could not load comparison') : undefined}
                  onRetry={() => comparison.refetch()}
                  defaultSort={{ field: 'rowNumber', dir: 'asc' }}
                  exportFileName={`${inquiry?.inquiry_number ?? 'inquiry'}-comparison`}
                  // Static on purpose: a template-literal class is invisible to
                  // Tailwind's scanner, so it would never be generated. Six
                  // supplier columns is the most any round has had.
                  minWidth="min-w-[1200px]"
                  pageSize={50}
                  mobileCard={false}
                  labels={{ empty: isHe ? 'אין נתוני השוואה' : 'No comparison data' }}
                />
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
