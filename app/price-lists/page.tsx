'use client'

/**
 * Supplier price lists, from Xpart.
 *
 * Xpart is where price lists are uploaded and parsed; this is a read-only window
 * onto them, so the dashboard can answer "what does this supplier charge" without
 * anyone switching apps. Nothing here writes — uploads stay in Xpart.
 */

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { ClipboardList, Crown, ExternalLink } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { formatNumber } from '@/lib/format'
import { useLocale } from '@/lib/locale-context'
import type { Provenance } from '@/lib/provenance'
import { xpartUrl } from '@/lib/xpart-links'

interface PriceList {
  price_list_id: string
  supplier_id: string | null
  supplier_finansit_code: string | null
  name: string
  version: number | null
  currency: string
  status: string
  is_promotional: boolean
  total_items: number | null
  effective_date: string | null
  supplier_name: string | null
  supplier_role: string | null
}

const STATUS_TONE: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  archived: 'bg-muted text-muted-foreground',
  draft: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
}

export default function PriceListsPage() {
  const router = useRouter()
  const { locale } = useLocale()
  const isHe = locale === 'he'

  const { data, isLoading, isError, refetch } = useQuery<{ lists: PriceList[]; provenance: Provenance }>({
    queryKey: ['xpart-price-lists'],
    queryFn: async () => {
      const res = await fetch('/api/xpart/price-lists')
      if (!res.ok) throw new Error('price lists unavailable')
      return res.json()
    },
    staleTime: 30 * 60 * 1000,
  })

  const lists = data?.lists ?? []
  const active = lists.filter(l => l.status === 'active')

  const columns: DataTableColumn<PriceList>[] = [
    {
      key: 'supplier_name',
      header: isHe ? 'ספק' : 'Supplier',
      sortable: true,
      cell: l => {
        const name = l.supplier_name ?? '—'
        return (
          <span className="flex items-center gap-1.5">
            {/* The official distributor's list is the retail baseline, not an offer
                to buy at — worth marking, since it otherwise reads as one more
                supplier quoting very high prices. */}
            {l.supplier_role === 'official_distributor' && <Crown className="h-3.5 w-3.5 text-amber-500" />}
            {/* Where the supplier has an ERP account, its dashboard page is the
                useful destination — open orders, deliveries, its catalogue.
                Lubinski, ORLYD and SOEX have no ERP account and would otherwise
                be dead text on 24 of the 32 rows, so those go to Xpart, which is
                the only place they exist. stopPropagation because the row itself
                navigates to the price list. */}
            {l.supplier_finansit_code ? (
              <Link
                href={`/suppliers/${encodeURIComponent(l.supplier_finansit_code)}`}
                onClick={e => e.stopPropagation()}
                className="text-primary hover:underline"
              >
                {name}
              </Link>
            ) : l.supplier_id ? (
              <a
                href={xpartUrl.supplier(l.supplier_id)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-primary hover:underline"
                title={isHe ? 'לספק אין חשבון ב‑ERP — נפתח ב‑Xpart' : 'No ERP account — opens in Xpart'}
              >
                {name}
                <ExternalLink className="h-3 w-3 opacity-60" />
              </a>
            ) : (
              name
            )}
          </span>
        )
      },
      exportValue: l => l.supplier_name ?? '',
    },
    {
      key: 'name',
      header: isHe ? 'מחירון' : 'Price list',
      sortable: true,
      truncate: 'max-w-[240px]',
      title: l => l.name,
      cell: l => (
        <span className="flex items-center gap-1.5">
          {l.name}
          {l.is_promotional && (
            <Badge variant="outline" className="text-[10px]">
              {isHe ? 'מבצע' : 'promo'}
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: isHe ? 'סטטוס' : 'Status',
      align: 'center',
      sortable: true,
      cell: l => (
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_TONE[l.status] ?? ''}`}>
          {l.status}
        </span>
      ),
    },
    {
      key: 'currency',
      header: isHe ? 'מטבע' : 'Currency',
      align: 'center',
      sortable: true,
      cell: l => l.currency,
    },
    {
      key: 'total_items',
      header: isHe ? 'פריטים' : 'Items',
      align: 'end',
      sortable: true,
      cell: l => (l.total_items == null ? '—' : formatNumber(l.total_items)),
      exportValue: l => l.total_items,
    },
    {
      key: 'effective_date',
      header: isHe ? 'בתוקף מ־' : 'Effective',
      sortable: true,
      cell: l => l.effective_date ?? '—',
    },
    {
      key: 'version',
      header: isHe ? 'גרסה' : 'Version',
      align: 'center',
      hideOnMobile: true,
      cell: l => `v${l.version ?? 1}`,
    },
  ]

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        icon={ClipboardList}
        title={isHe ? 'מחירוני ספקים' : 'Supplier price lists'}
        description={
          isHe
            ? `${formatNumber(lists.length)} מחירונים · ${formatNumber(active.length)} פעילים · נתונים מ‑Xpart`
            : `${formatNumber(lists.length)} lists · ${formatNumber(active.length)} active · from Xpart`
        }
        provenance={data?.provenance}
      />

      <Card>
        <CardContent className="p-3 sm:p-4">
          <DataTable
            rows={lists}
            columns={columns}
            getRowKey={l => l.price_list_id}
            loading={isLoading}
            error={isError ? (isHe ? 'לא ניתן לטעון מחירונים' : 'Could not load price lists') : undefined}
            onRetry={() => refetch()}
            onRowClick={l => router.push(`/price-lists/${l.price_list_id}`)}
            defaultSort={{ field: 'effective_date', dir: 'desc' }}
            exportFileName={isHe ? 'מחירוני-ספקים' : 'price-lists'}
            minWidth="min-w-[720px]"
            pageSize={25}
            labels={{ empty: isHe ? 'אין מחירונים' : 'No price lists' }}
            mobileCard={{
              title: l => l.supplier_name ?? '—',
              subtitle: l => l.name,
              accent: l => (l.total_items == null ? '—' : formatNumber(l.total_items)),
              fields: [
                { label: isHe ? 'סטטוס' : 'Status', value: l => l.status },
                { label: isHe ? 'בתוקף מ־' : 'Effective', value: l => l.effective_date ?? '—' },
              ],
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
