'use client'

/**
 * Supplier credits — money coming back from suppliers, which had no screen.
 *
 * A credit is a format 51 document with a negative total; there is no dedicated
 * format. See the route for the two traps (quote grand_total not total; never
 * filter the ERP by date for a "recent" question).
 */

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { Undo2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { formatCurrency, formatNumber } from '@/lib/format'
import type { Provenance } from '@/lib/provenance'

interface Credit {
  doc_number: string
  doc_date: string | null
  year: string | null
  supplier_code: string | null
  supplier_name: string | null
  grand_total: number
  total: number
}

interface CreditsResponse {
  credits: Credit[]
  scanned: number
  totalCredited: number
  provenance: Provenance
}

const COLUMNS: DataTableColumn<Credit>[] = [
  {
    key: 'doc_number',
    header: 'מסמך',
    sortable: true,
    // The document viewer needs the year as well: a 2025 and a 2026 document
    // can carry the same number, so linking on number alone opens the wrong one.
    cell: c => (
      <Link
        href={`/documents/51/${encodeURIComponent(c.doc_number)}${c.year ? `?year=${c.year}` : ''}`}
        className="font-mono text-xs text-primary hover:underline"
      >
        51/{c.doc_number}
      </Link>
    ),
    exportValue: c => `51/${c.doc_number}`,
  },
  {
    key: 'doc_date',
    header: 'תאריך',
    sortable: true,
    cell: c => c.doc_date ?? '—',
  },
  {
    key: 'supplier_name',
    header: 'ספק',
    sortable: true,
    truncate: 'max-w-[260px]',
    title: c => c.supplier_name ?? '',
    cell: c => c.supplier_name ?? c.supplier_code ?? '—',
  },
  {
    key: 'grand_total',
    header: 'סכום כולל מע״מ',
    align: 'end',
    sortable: true,
    // Shown as a positive credit — the sign is in the column name, and a column
    // of negative numbers reads as a loss when it is money coming back.
    cell: c => (
      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
        {formatCurrency(Math.abs(c.grand_total))}
      </span>
    ),
    exportValue: c => Math.abs(c.grand_total),
    sortValue: c => Math.abs(c.grand_total),
  },
  {
    key: 'total',
    header: 'לפני מע״מ',
    align: 'end',
    hideOnMobile: true,
    cell: c => formatCurrency(Math.abs(c.total)),
    exportValue: c => Math.abs(c.total),
  },
]

export default function SupplierCreditsPage() {
  const { data, isLoading, isError, refetch } = useQuery<CreditsResponse>({
    queryKey: ['supplier-credits'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/supplier-credits')
      if (!res.ok) throw new Error('credits unavailable')
      return res.json()
    },
    staleTime: 15 * 60 * 1000,
  })

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        icon={Undo2}
        title="זיכויי ספקים"
        description="מסמכי פורמט 51 עם סכום שלילי — אין פורמט ייעודי לזיכוי ספק"
        provenance={data?.provenance}
      />

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">סך הזיכויים</div>
            <div className="text-2xl font-bold tabular-nums">
              {data ? formatCurrency(data.totalCredited) : '—'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground">מסמכים שנסרקו</div>
            <div className="text-2xl font-bold tabular-nums">
              {data ? formatNumber(data.scanned) : '—'}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-3 sm:p-4">
          <DataTable
            rows={data?.credits ?? []}
            columns={COLUMNS}
            // Not doc_number alone: the wider scan now spans 2025 and 2026, and
            // a document number is unique per YEAR, not across them. Two rows
            // sharing a React key make one of them vanish.
            getRowKey={c => `${c.year ?? '?'}/${c.doc_number}`}
            loading={isLoading}
            error={isError ? 'לא ניתן לטעון זיכויי ספקים' : undefined}
            onRetry={() => refetch()}
            defaultSort={{ field: 'doc_date', dir: 'desc' }}
            exportFileName="זיכויי-ספקים"
            minWidth="min-w-[560px]"
            labels={{ empty: 'לא נמצאו זיכויי ספקים בטווח שנסרק' }}
            mobileCard={{
              title: c => c.supplier_name ?? c.supplier_code ?? '—',
              subtitle: c => `51/${c.doc_number}`,
              accent: c => formatCurrency(Math.abs(c.grand_total)),
              fields: [{ label: 'תאריך', value: c => c.doc_date ?? '—' }],
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
