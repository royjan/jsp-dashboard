'use client'

/**
 * Procurement rounds running in Xpart.
 *
 * An inquiry is one batch of parts sent out to every supplier for pricing —
 * 500 to 1,200 lines at a time. This is a read-only window: the round is run in
 * Xpart, and nothing here can change it.
 */

import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { FileSearch } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { formatNumber } from '@/lib/format'
import { useLocale } from '@/lib/locale-context'
import type { Provenance } from '@/lib/provenance'

interface Inquiry {
  inquiry_id: string
  inquiry_number: string
  status: string
  total_items: number | null
  customer_reference: string | null
  created_at: string
  finansit_doc_number: string | null
  created_by_name: string | null
  snapshot_status: string | null
  snapshot_computed_at: string | null
}

const STATUS_TONE: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  pending_quotes: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  analyzing: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  cancelled: 'bg-muted text-muted-foreground line-through',
}

export default function InquiriesPage() {
  const router = useRouter()
  const { locale } = useLocale()
  const isHe = locale === 'he'

  const { data, isLoading, isError, refetch } = useQuery<{ inquiries: Inquiry[]; provenance: Provenance }>({
    queryKey: ['xpart-inquiries'],
    queryFn: async () => {
      const res = await fetch('/api/xpart/inquiries')
      if (!res.ok) throw new Error('inquiries unavailable')
      return res.json()
    },
    staleTime: 15 * 60 * 1000,
  })

  const inquiries = data?.inquiries ?? []

  const columns: DataTableColumn<Inquiry>[] = [
    {
      key: 'inquiry_number',
      header: isHe ? 'פנייה' : 'Inquiry',
      sortable: true,
      cell: i => <span className="font-mono text-xs">{i.inquiry_number}</span>,
    },
    {
      key: 'status',
      header: isHe ? 'סטטוס' : 'Status',
      align: 'center',
      sortable: true,
      cell: i => (
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_TONE[i.status] ?? ''}`}>
          {i.status}
        </span>
      ),
    },
    {
      key: 'total_items',
      header: isHe ? 'פריטים' : 'Items',
      align: 'end',
      sortable: true,
      cell: i => (i.total_items == null ? '—' : formatNumber(i.total_items)),
      exportValue: i => i.total_items,
    },
    {
      key: 'finansit_doc_number',
      header: isHe ? 'מסמך ERP' : 'ERP doc',
      hideOnMobile: true,
      cell: i => i.finansit_doc_number ?? '—',
    },
    {
      key: 'snapshot_status',
      header: isHe ? 'השוואה' : 'Comparison',
      align: 'center',
      cell: i =>
        i.snapshot_status ? (
          <span
            className={
              i.snapshot_status === 'fresh'
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-muted-foreground'
            }
          >
            {i.snapshot_status}
          </span>
        ) : (
          // Not "no data": the round may simply never have been compared.
          <span className="text-xs text-muted-foreground">{isHe ? 'לא חושבה' : 'not computed'}</span>
        ),
      exportValue: i => i.snapshot_status ?? '',
    },
    {
      key: 'created_at',
      header: isHe ? 'נוצרה' : 'Created',
      sortable: true,
      cell: i => i.created_at?.slice(0, 10) ?? '—',
    },
    {
      key: 'created_by_name',
      header: isHe ? 'נוצרה ע״י' : 'Created by',
      hideOnMobile: true,
      cell: i => i.created_by_name ?? '—',
    },
  ]

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        icon={FileSearch}
        title={isHe ? 'פניות לספקים' : 'Supplier inquiries'}
        description={
          isHe
            ? `${formatNumber(inquiries.length)} סבבי תמחור · נתונים מ‑Xpart (קריאה בלבד)`
            : `${formatNumber(inquiries.length)} pricing rounds · from Xpart (read-only)`
        }
        provenance={data?.provenance}
      />

      <Card>
        <CardContent className="p-3 sm:p-4">
          <DataTable
            rows={inquiries}
            columns={columns}
            getRowKey={i => i.inquiry_id}
            loading={isLoading}
            error={isError ? (isHe ? 'לא ניתן לטעון פניות' : 'Could not load inquiries') : undefined}
            onRetry={() => refetch()}
            onRowClick={i => router.push(`/inquiries/${i.inquiry_id}`)}
            defaultSort={{ field: 'created_at', dir: 'desc' }}
            exportFileName={isHe ? 'פניות-לספקים' : 'inquiries'}
            minWidth="min-w-[760px]"
            labels={{ empty: isHe ? 'אין פניות' : 'No inquiries' }}
            mobileCard={{
              title: i => i.inquiry_number,
              subtitle: i => i.status,
              accent: i => formatNumber(i.total_items ?? 0),
              fields: [{ label: isHe ? 'נוצרה' : 'Created', value: i => i.created_at?.slice(0, 10) ?? '—' }],
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
