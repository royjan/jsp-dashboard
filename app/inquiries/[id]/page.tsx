'use client'

/**
 * One procurement round: who quoted what, and the comparison Xpart computed
 * from it.
 *
 * The comparison grid is Xpart's own snapshot rendered as-is — see the API route
 * for why it is not recomputed here. Its age and freshness are shown next to it
 * rather than hidden, because a stale snapshot is still the number the buyer
 * worked from and pretending otherwise helps nobody.
 *
 * There used to be an "items" tab beside it listing the lines that went out.
 * It was the same rows with fewer columns — the comparison already carries the
 * part, the description and the quantity — so the tab bar bought nothing and
 * cost a click. What the items table did carry and the grid did not, the
 * duplicate-part highlight, moved onto the grid.
 */

import { use } from 'react'
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

export default function InquiryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { locale } = useLocale()
  const isHe = locale === 'he'

  const head = useQuery<{ inquiry: Inquiry; coverage: Coverage[]; provenance: Provenance }>({
    queryKey: ['xpart-inquiry', id],
    queryFn: async () => {
      const res = await fetch(`/api/xpart/inquiries/${id}`)
      if (!res.ok) throw new Error('inquiry unavailable')
      return res.json()
    },
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
    staleTime: 15 * 60 * 1000,
  })

  const inquiry = head.data?.inquiry
  const suppliers = comparison.data?.payload?.suppliers ?? []
  const snapshotItems = comparison.data?.payload?.items ?? []

  // A part quoted twice in the same round is worth seeing: the two lines
  // compete against each other and one of them is usually a mistake.
  const dupKeys = new Set<string>()
  const seen = new Set<string>()
  for (const it of snapshotItems) {
    const key = `${it.brandName ?? ''}|${it.partNumber ?? ''}`
    if (seen.has(key)) dupKeys.add(key)
    seen.add(key)
  }

  // The supplier whose basket comes out cheapest overall — the one number the
  // coverage tiles above cannot show.
  const cheapestKey = suppliers.reduce<{ key: string | null; cost: number }>(
    (best, s) =>
      s.totalCostIls != null && s.totalCostIls > 0 && s.totalCostIls < best.cost
        ? { key: s.columnKey, cost: s.totalCostIls }
        : best,
    { key: null, cost: Infinity },
  ).key

  const comparisonColumns: DataTableColumn<SnapshotItem>[] = [
    {
      key: 'rowNumber',
      header: '#',
      align: 'end',
      sortable: true,
      // The line number sits right against the part number under RTL, and two
      // adjacent numbers with nothing between them read as one long number
      // ("012745" + "1" → "0127451"). Keep it narrow, quiet, and spaced off
      // the column beside it.
      headerClassName: 'w-10 pe-4',
      cellClassName: 'w-10 pe-4 text-muted-foreground',
      cell: i => i.rowNumber ?? '—',
      exportValue: i => i.rowNumber ?? null,
      exportHeader: '#',
    },
    {
      key: 'partNumber',
      header: isHe ? 'מק״ט' : 'Part',
      sortable: true,
      cell: i => (i.partNumber ? <ItemLink code={i.partNumber} showCode copyable={false} /> : '—'),
      exportValue: i => i.partNumber ?? '',
    },
    {
      key: 'description',
      header: isHe ? 'תיאור' : 'Description',
      truncate: 'max-w-[240px]',
      hideOnMobile: true,
      title: i => i.description ?? '',
      cell: i => <span dir="auto">{i.description ?? '—'}</span>,
      exportValue: i => i.description ?? '',
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
                <span className="text-sm font-medium text-foreground">
                  {isHe ? 'השוואת ספקים' : 'Supplier comparison'}
                </span>
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
              </div>

              {suppliers.length > 0 && (
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                  {suppliers.map(s => {
                    const isCheapest = s.columnKey === cheapestKey
                    return (
                      <div
                        key={s.columnKey}
                        className={
                          'rounded-md border p-2 ' +
                          (isCheapest
                            ? 'border-emerald-500/40 bg-emerald-500/5'
                            : 'bg-card')
                        }
                      >
                        <div className="truncate text-xs font-medium">
                          {s.displayName ?? s.supplierName}
                        </div>
                        <div
                          className={
                            'text-sm font-semibold tabular-nums ' +
                            (isCheapest ? 'text-emerald-600 dark:text-emerald-400' : '')
                          }
                        >
                          {s.totalCostIls == null ? '—' : formatCurrency(s.totalCostIls)}
                        </div>
                        <div className="text-[11px] text-muted-foreground tabular-nums">
                          {formatNumber(s.itemsWithPrice ?? 0)}/{formatNumber(s.totalItems ?? 0)}
                          {s.avgMarginPct != null && ` · ${s.avgMarginPct.toFixed(0)}%`}
                        </div>
                      </div>
                    )
                  })}
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
                // A page of 50 lines is taller than the viewport, so the header
                // scrolls away exactly when the supplier columns stop being
                // self-explanatory. Capping the height gives the sticky header
                // something to stick to.
                maxHeight="65vh"
                mobileCard={false}
                rowClassName={i =>
                  dupKeys.has(`${i.brandName ?? ''}|${i.partNumber ?? ''}`) ? 'bg-red-500/5' : ''
                }
                labels={{ empty: isHe ? 'אין נתוני השוואה' : 'No comparison data' }}
              />
              <p className="text-xs text-muted-foreground">
                {isHe
                  ? 'ירוק — המחיר הזול ביותר לשורה · רקע אדום — מק״ט שמופיע יותר מפעם אחת'
                  : 'Green — cheapest price on the line · Red — part appears more than once'}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
