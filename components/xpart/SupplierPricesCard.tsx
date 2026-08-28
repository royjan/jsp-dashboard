'use client'

/**
 * What each supplier charges for this part.
 *
 * The prices come from Xpart's price lists (mirrored into dashboard.xpart_supplier_prices).
 * Landed ₪ is Xpart's own cost formula — supplier price x import markup x FX —
 * so it is comparable across a EUR list, a USD list and an ILS one.
 *
 * Lubinski is shown apart from the rest: it is the official distributor, so its
 * number is the retail price we sell against, not a supplier we buy from.
 * Averaging it into "cheapest" would compare a shelf price with a landed cost.
 */

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Coins, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { FreshnessChip } from '@/components/shared/FreshnessChip'
import { formatCurrency, formatNumber } from '@/lib/format'
import { xpartUrl } from '@/lib/xpart-links'
import type { Provenance } from '@/lib/provenance'

interface SupplierPrice {
  supplier_code: string
  supplier_name: string
  is_retail: boolean
  price: number
  currency: string
  landed_ils: number | null
  import_markup: number | null
  price_list_name: string | null
  effective_date: string | null
  via_code?: string
  /** ERP code, where the supplier has an account. Null for Lubinski/ORLYD/SOEX. */
  supplier_finansit_code?: string | null
  /** Xpart's own id — the fallback destination for the three with no ERP account. */
  supplier_xpart_id?: string | null
}

interface Response {
  itemCode: string
  prices: SupplierPrice[]
  retailIls: number | null
  cheapestLandedIls: number | null
  cheapestSupplier: string | null
  provenance: Provenance
}

function marginPct(landed: number | null, retail: number | null): number | null {
  if (!landed || !retail || retail <= 0) return null
  return (1 - landed / retail) * 100
}

/** Same thresholds Xpart's own margin chip uses, so the two apps agree on colour. */
function marginTone(pct: number | null): string {
  if (pct == null) return 'text-muted-foreground'
  if (pct >= 80) return 'text-emerald-600 dark:text-emerald-400'
  if (pct >= 60) return 'text-blue-600 dark:text-blue-400'
  if (pct >= 40) return 'text-amber-600 dark:text-amber-400'
  return 'text-red-600 dark:text-red-400'
}

export function SupplierPricesCard({ code, isHe }: { code: string; isHe: boolean }) {
  const { data, isLoading, isError, refetch } = useQuery<Response>({
    queryKey: ['xpart-item-prices', code],
    queryFn: async () => {
      const res = await fetch(`/api/xpart/prices/item/${encodeURIComponent(code)}`)
      if (!res.ok) throw new Error('supplier prices unavailable')
      return res.json()
    },
    enabled: !!code,
    staleTime: 30 * 60 * 1000,
  })

  const retail = data?.retailIls ?? null
  const purchasable = (data?.prices ?? []).filter(p => !p.is_retail)
  const retailRow = (data?.prices ?? []).find(p => p.is_retail) ?? null

  // Nothing priced anywhere is the common case for a part no supplier lists.
  // Say so, rather than drawing an empty table under a promising heading.
  if (!isLoading && !isError && purchasable.length === 0 && !retailRow) return null

  const columns: DataTableColumn<SupplierPrice>[] = [
    {
      key: 'supplier_name',
      header: isHe ? 'ספק' : 'Supplier',
      sortable: true,
      cell: p => (
        <span className="flex items-center gap-1.5">
          {/* The name was dead text on the one card where "who do we buy this
              from" is the question being asked. Where the supplier has an ERP
              account its dashboard page is the destination — open orders,
              deliveries, its catalogue. Lubinski, ORLYD and SOEX have none, so
              those go to Xpart, the only system they exist in, marked with an
              external-link icon and a title saying why. */}
          {p.supplier_finansit_code ? (
            <Link
              href={`/suppliers/${encodeURIComponent(p.supplier_finansit_code)}`}
              className="text-primary hover:underline"
            >
              {p.supplier_name}
            </Link>
          ) : p.supplier_xpart_id ? (
            <a
              href={xpartUrl.supplier(p.supplier_xpart_id)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
              title={isHe ? 'לספק אין חשבון ב‑ERP — נפתח ב‑Xpart' : 'No ERP account — opens in Xpart'}
            >
              {p.supplier_name}
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
          ) : (
            p.supplier_name
          )}
          {p.via_code && p.via_code !== code && (
            <Badge variant="outline" className="text-[10px] font-mono">
              {p.via_code}
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'price',
      header: isHe ? 'מחיר ספק' : 'Their price',
      align: 'end',
      sortable: true,
      cell: p => `${formatNumber(p.price)} ${p.currency}`,
      exportValue: p => p.price,
    },
    {
      key: 'landed_ils',
      header: isHe ? 'עלות נחיתה ₪' : 'Landed ₪',
      align: 'end',
      sortable: true,
      cell: p => (
        <span className={p.landed_ils === data?.cheapestLandedIls ? 'font-semibold text-emerald-600 dark:text-emerald-400' : ''}>
          {p.landed_ils == null ? '—' : formatCurrency(p.landed_ils)}
        </span>
      ),
      exportValue: p => p.landed_ils,
    },
    {
      key: 'margin',
      header: isHe ? 'רווח' : 'Margin',
      align: 'end',
      sortable: true,
      sortValue: p => marginPct(p.landed_ils, retail) ?? -Infinity,
      cell: p => {
        const pct = marginPct(p.landed_ils, retail)
        return <span className={marginTone(pct)}>{pct == null ? '—' : `${pct.toFixed(1)}%`}</span>
      },
      exportValue: p => marginPct(p.landed_ils, retail),
    },
    {
      key: 'price_list_name',
      header: isHe ? 'מחירון' : 'Price list',
      hideOnMobile: true,
      truncate: 'max-w-[180px]',
      title: p => p.price_list_name ?? '',
      cell: p => <span className="text-xs text-muted-foreground">{p.price_list_name?.trim() || '—'}</span>,
    },
    {
      key: 'effective_date',
      header: isHe ? 'בתוקף מ־' : 'Effective',
      hideOnMobile: true,
      sortable: true,
      cell: p => p.effective_date ?? '—',
    },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <Coins className="h-4 w-4 text-amber-500" />
          {isHe ? 'מחירי ספקים' : 'Supplier prices'}
          {data?.provenance && <FreshnessChip provenance={data.provenance} />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {retailRow && (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              {isHe ? 'מחירון לובינסקי (קמעונאי)' : 'Lubinski list (retail)'}
            </span>
            <span className="font-semibold tabular-nums">{formatCurrency(retailRow.price)}</span>
            {data?.cheapestSupplier && data.cheapestLandedIls != null && (
              <span className="text-xs text-muted-foreground">
                {isHe
                  ? `הזול ביותר: ${data.cheapestSupplier} · ${formatCurrency(data.cheapestLandedIls)}`
                  : `Cheapest: ${data.cheapestSupplier} · ${formatCurrency(data.cheapestLandedIls)}`}
              </span>
            )}
          </div>
        )}

        <DataTable
          rows={purchasable}
          columns={columns}
          getRowKey={p => p.supplier_code}
          loading={isLoading}
          error={isError ? (isHe ? 'לא ניתן לטעון מחירי ספקים' : 'Could not load supplier prices') : undefined}
          onRetry={() => refetch()}
          defaultSort={{ field: 'landed_ils', dir: 'asc' }}
          minWidth="min-w-[560px]"
          maxHeight="none"
          exportFileName={`מחירי-ספקים-${code}`}
          labels={{ empty: isHe ? 'אף ספק לא מתמחר את הפריט הזה' : 'No supplier prices this part' }}
          mobileCard={{
            title: p => p.supplier_name,
            subtitle: p => `${formatNumber(p.price)} ${p.currency}`,
            accent: p => (p.landed_ils == null ? '—' : formatCurrency(p.landed_ils)),
            fields: [
              {
                label: isHe ? 'רווח' : 'Margin',
                value: p => {
                  const pct = marginPct(p.landed_ils, retail)
                  return pct == null ? '—' : `${pct.toFixed(1)}%`
                },
              },
            ],
          }}
        />
      </CardContent>
    </Card>
  )
}
