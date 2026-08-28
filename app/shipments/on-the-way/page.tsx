'use client'

/**
 * Goods ordered and not yet arrived.
 *
 * The tab beside this one, /shipments, only knows about a carton once it has
 * been scanned in the warehouse — everything between placing the order and the
 * pallet landing was invisible in this app. Xpart holds that stretch: purchase
 * orders it pushed into Finansit as 61 documents and has not seen received.
 *
 * There is no ETA column, because there is no ETA: expected_delivery is NULL on
 * every one of these orders. Age since the order date is what the data actually
 * supports, so that is what is shown.
 */

import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Truck } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { SubTabs } from '@/components/shared/SubTabs'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { StatGrid, StatTile } from '@/components/shared/StatTile'
import { formatNumber } from '@/lib/format'
import { useLocale } from '@/lib/locale-context'
import { XpartLink } from '@/components/xpart/XpartLink'
import { xpartUrl } from '@/lib/xpart-links'
import type { Provenance } from '@/lib/provenance'

interface OpenOrder {
  order_id: string
  order_number: string
  supplier_name: string | null
  supplier_finansit_code: string | null
  order_date: string | null
  finansit_doc_number: string | null
  total_items: number | null
  total_value: number | null
  currency: string | null
  inquiry_number: string | null
  days_open: number | null
}

interface Response {
  orders: OpenOrder[]
  summary: { count: number; items: number; byCurrency: Record<string, number> } | null
  provenance: Provenance
}

const MONEY = new Map<string, Intl.NumberFormat>()
function money(value: number, currency: string): string {
  if (!MONEY.has(currency)) {
    MONEY.set(
      currency,
      new Intl.NumberFormat('he-IL', { style: 'currency', currency, maximumFractionDigits: 0 }),
    )
  }
  return MONEY.get(currency)!.format(value)
}

export default function OnTheWayPage() {
  const { locale } = useLocale()
  const isHe = locale === 'he'

  const { data, isLoading, isError, refetch } = useQuery<Response>({
    queryKey: ['xpart-open-orders'],
    queryFn: async () => {
      const res = await fetch('/api/xpart/orders')
      if (!res.ok) throw new Error('open orders unavailable')
      return res.json()
    },
    staleTime: 30 * 60 * 1000,
  })

  const tabs = [
    { href: '/shipments/on-the-way', label: isHe ? 'בדרך' : 'On the way' },
    { href: '/shipments', label: isHe ? 'התקבל במחסן' : 'Received' },
  ]

  const columns: DataTableColumn<OpenOrder>[] = [
    {
      key: 'order_number',
      header: isHe ? 'הזמנה' : 'Order',
      sortable: true,
      cell: o => <span className="font-mono text-xs">{o.order_number}</span>,
    },
    {
      key: 'supplier_name',
      header: isHe ? 'ספק' : 'Supplier',
      sortable: true,
      cell: o =>
        o.supplier_finansit_code ? (
          <Link href={`/suppliers/${o.supplier_finansit_code}`} className="text-primary hover:underline">
            {o.supplier_name}
          </Link>
        ) : (
          (o.supplier_name ?? '—')
        ),
      exportValue: o => o.supplier_name ?? '',
    },
    {
      key: 'finansit_doc_number',
      header: isHe ? 'מסמך ERP' : 'ERP doc',
      sortable: true,
      hideOnMobile: true,
      cell: o =>
        o.finansit_doc_number ? (
          <Link
            href={`/documents/61/${encodeURIComponent(o.finansit_doc_number)}`}
            className="font-mono text-xs text-primary hover:underline"
          >
            61/{o.finansit_doc_number}
          </Link>
        ) : (
          '—'
        ),
      exportValue: o => o.finansit_doc_number ?? '',
    },
    {
      key: 'order_date',
      header: isHe ? 'תאריך' : 'Ordered',
      sortable: true,
      cell: o => o.order_date?.slice(0, 10) ?? '—',
    },
    {
      key: 'days_open',
      header: isHe ? 'ימים פתוח' : 'Days open',
      align: 'end',
      sortable: true,
      cell: o => (
        <span className={(o.days_open ?? 0) > 60 ? 'text-amber-600 dark:text-amber-400' : ''}>
          {o.days_open == null ? '—' : `${formatNumber(o.days_open)}`}
        </span>
      ),
      exportValue: o => o.days_open,
    },
    {
      key: 'total_items',
      header: isHe ? 'פריטים' : 'Items',
      align: 'end',
      sortable: true,
      cell: o => (o.total_items == null ? '—' : formatNumber(o.total_items)),
      exportValue: o => o.total_items,
    },
    {
      key: 'total_value',
      header: isHe ? 'שווי' : 'Value',
      align: 'end',
      sortable: true,
      cell: o => (o.total_value == null ? '—' : money(o.total_value, o.currency ?? 'EUR')),
      exportValue: o => o.total_value,
    },
    {
      key: 'inquiry_number',
      header: isHe ? 'פנייה' : 'Inquiry',
      hideOnMobile: true,
      cell: o => o.inquiry_number ?? '—',
    },
    {
      key: 'xpart',
      header: '',
      // Chrome, not data — excluded from the xlsx export.
      exportValue: null,
      cell: o => <XpartLink href={xpartUrl.order(o.order_id)} />,
    },
  ]

  const currencies = Object.entries(data?.summary?.byCurrency ?? {})

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        icon={Truck}
        title={isHe ? 'משלוחים' : 'Shipments'}
        description={
          isHe
            ? 'הזמנות רכש שיצאו ועוד לא התקבלו במחסן · מקור: Xpart'
            : 'Purchase orders placed and not yet received · source: Xpart'
        }
        provenance={data?.provenance}
      />

      <SubTabs tabs={tabs} />

      <StatGrid columns={4}>
        <StatTile
          label={isHe ? 'הזמנות פתוחות' : 'Open orders'}
          value={formatNumber(data?.summary?.count ?? 0)}
          loading={isLoading}
          index={0}
        />
        <StatTile
          label={isHe ? 'פריטים בדרך' : 'Items on the way'}
          value={formatNumber(data?.summary?.items ?? 0)}
          loading={isLoading}
          index={1}
        />
        {/* Deliberately one tile per currency rather than a single total: these
            orders are EUR and USD and carry no rate of their own, so summing
            them would invent a conversion the data does not have. */}
        {currencies.map(([cur, total], i) => (
          <StatTile
            key={cur}
            label={isHe ? `שווי ${cur}` : `Value ${cur}`}
            value={money(total, cur)}
            loading={isLoading}
            index={2 + i}
          />
        ))}
      </StatGrid>

      <Card>
        <CardContent className="p-3 sm:p-4">
          <DataTable
            rows={data?.orders ?? []}
            columns={columns}
            getRowKey={o => o.order_id}
            loading={isLoading}
            error={isError ? (isHe ? 'לא ניתן לטעון הזמנות פתוחות' : 'Could not load open orders') : undefined}
            onRetry={() => refetch()}
            defaultSort={{ field: 'order_date', dir: 'desc' }}
            exportFileName={isHe ? 'הזמנות-בדרך' : 'orders-on-the-way'}
            minWidth="min-w-[860px]"
            pageSize={25}
            labels={{ empty: isHe ? 'אין הזמנות פתוחות' : 'No open orders' }}
            mobileCard={{
              title: o => o.supplier_name ?? '—',
              subtitle: o => o.order_number,
              accent: o => (o.total_value == null ? '—' : money(o.total_value, o.currency ?? 'EUR')),
              fields: [
                { label: isHe ? 'פריטים' : 'Items', value: o => formatNumber(o.total_items ?? 0) },
                { label: isHe ? 'ימים פתוח' : 'Days open', value: o => String(o.days_open ?? '—') },
              ],
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
