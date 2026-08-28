'use client'

/**
 * Supplier invoices recorded in Xpart.
 *
 * Thin on purpose: Xpart holds two of these today. The screen exists so it
 * fills as they use it, and so the payment and reconciliation state is visible
 * from here rather than only in the other app.
 */

import { useQuery } from '@tanstack/react-query'
import { ReceiptText } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/PageHeader'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { formatNumber } from '@/lib/format'
import { useLocale } from '@/lib/locale-context'
import type { Provenance } from '@/lib/provenance'

interface Invoice {
  invoice_id: string
  invoice_number: string
  supplier_invoice_number: string | null
  supplier_name: string | null
  invoice_date: string | null
  currency: string | null
  total_amount: number | null
  amount_paid: number | null
  payment_status: string | null
  reconciliation_status: string | null
  item_count: number
}

const PAY_TONE: Record<string, string> = {
  unpaid: 'bg-red-500/10 text-red-600 dark:text-red-400',
  partial: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  paid: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
}
const REC_TONE: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  matched: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  discrepancy: 'bg-red-500/10 text-red-600 dark:text-red-400',
}

const MONEY = new Map<string, Intl.NumberFormat>()
function money(value: number, currency: string): string {
  if (!MONEY.has(currency)) {
    MONEY.set(currency, new Intl.NumberFormat('he-IL', { style: 'currency', currency, maximumFractionDigits: 0 }))
  }
  return MONEY.get(currency)!.format(value)
}

export default function InvoicesPage() {
  const { locale } = useLocale()
  const isHe = locale === 'he'

  const { data, isLoading, isError, refetch } = useQuery<{ invoices: Invoice[]; provenance: Provenance }>({
    queryKey: ['xpart-invoices'],
    queryFn: async () => {
      const res = await fetch('/api/xpart/invoices')
      if (!res.ok) throw new Error('invoices unavailable')
      return res.json()
    },
    staleTime: 15 * 60 * 1000,
  })

  const invoices = data?.invoices ?? []

  const columns: DataTableColumn<Invoice>[] = [
    {
      key: 'invoice_number',
      header: isHe ? 'חשבונית' : 'Invoice',
      sortable: true,
      cell: i => <span className="font-mono text-xs">{i.invoice_number}</span>,
    },
    {
      key: 'supplier_name',
      header: isHe ? 'ספק' : 'Supplier',
      sortable: true,
      cell: i => i.supplier_name ?? '—',
    },
    {
      key: 'supplier_invoice_number',
      header: isHe ? 'אסמכתא של הספק' : "Supplier's ref",
      hideOnMobile: true,
      truncate: 'max-w-[220px]',
      title: i => i.supplier_invoice_number ?? '',
      cell: i => i.supplier_invoice_number ?? '—',
    },
    {
      key: 'invoice_date',
      header: isHe ? 'תאריך' : 'Date',
      sortable: true,
      cell: i => i.invoice_date ?? '—',
    },
    {
      key: 'item_count',
      header: isHe ? 'שורות' : 'Lines',
      align: 'end',
      sortable: true,
      cell: i => formatNumber(i.item_count),
      exportValue: i => i.item_count,
    },
    {
      key: 'total_amount',
      header: isHe ? 'סכום' : 'Total',
      align: 'end',
      sortable: true,
      cell: i => (i.total_amount == null ? '—' : money(i.total_amount, i.currency ?? 'EUR')),
      exportValue: i => i.total_amount,
    },
    {
      key: 'payment_status',
      header: isHe ? 'תשלום' : 'Payment',
      align: 'center',
      sortable: true,
      cell: i => (
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${PAY_TONE[i.payment_status ?? ''] ?? ''}`}>
          {i.payment_status ?? '—'}
        </span>
      ),
    },
    {
      key: 'reconciliation_status',
      header: isHe ? 'התאמה' : 'Reconciliation',
      align: 'center',
      hideOnMobile: true,
      cell: i => (
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${REC_TONE[i.reconciliation_status ?? ''] ?? ''}`}>
          {i.reconciliation_status ?? '—'}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        icon={ReceiptText}
        title={isHe ? 'חשבוניות ספקים' : 'Supplier invoices'}
        description={
          isHe
            ? `${formatNumber(invoices.length)} חשבוניות · נתונים מ‑Xpart (קריאה בלבד)`
            : `${formatNumber(invoices.length)} invoices · from Xpart (read-only)`
        }
        provenance={data?.provenance}
      />

      <Card>
        <CardContent className="p-3 sm:p-4">
          <DataTable
            rows={invoices}
            columns={columns}
            getRowKey={i => i.invoice_id}
            loading={isLoading}
            error={isError ? (isHe ? 'לא ניתן לטעון חשבוניות' : 'Could not load invoices') : undefined}
            onRetry={() => refetch()}
            defaultSort={{ field: 'invoice_date', dir: 'desc' }}
            exportFileName={isHe ? 'חשבוניות-ספקים' : 'supplier-invoices'}
            minWidth="min-w-[820px]"
            labels={{
              empty: isHe
                ? 'אין חשבוניות ספקים ב‑Xpart'
                : 'No supplier invoices in Xpart',
            }}
            mobileCard={{
              title: i => i.supplier_name ?? '—',
              subtitle: i => i.invoice_number,
              accent: i => (i.total_amount == null ? '—' : money(i.total_amount, i.currency ?? 'EUR')),
              fields: [
                { label: isHe ? 'תאריך' : 'Date', value: i => i.invoice_date ?? '—' },
                { label: isHe ? 'תשלום' : 'Payment', value: i => i.payment_status ?? '—' },
              ],
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
