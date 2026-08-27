'use client'

/** שנים — every fiscal year the books hold, and how each one closed. */

import { Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/feedback-state'
import { formatCurrency, formatDate, formatId } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useBooksYears } from '@/hooks/use-books'
import { useBooksScope } from '@/components/books/use-books-scope'
import { useBooksText } from '@/components/books/BooksChrome'
import { YearsChart } from '@/components/books/BooksCharts'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'

/** One fiscal year's totals, joined with the metadata about how it is served. */
interface YearRow {
  year: number
  movements: number
  sales: number
  receipts: number
  debit: number
  credit: number
  state?: string
  refreshed_at?: string | null
}

type BooksT = ReturnType<typeof useBooksText>['t']

function buildColumns(
  t: BooksT,
  onPickYear: (y: number) => void,
): DataTableColumn<YearRow>[] {
  return [
    {
      key: 'year',
      header: t('year'),
      sortable: true,
      cell: r => (
        <button type="button" onClick={() => onPickYear(r.year)} className="font-mono text-primary hover:underline">
          {formatId(r.year)}
        </button>
      ),
      exportValue: r => r.year,
    },
    {
      key: 'state',
      header: t('live'),
      sortable: true,
      cell: r => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            r.state === 'live'
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {r.state === 'live' ? t('live') : t('closedYear')}
        </span>
      ),
      exportValue: r => (r.state === 'live' ? 'live' : 'closed'),
    },
    { key: 'movements', header: t('movements'), align: 'end', sortable: true, cell: r => formatId(r.movements), exportValue: r => r.movements },
    { key: 'sales', header: t('sales'), align: 'end', sortable: true, cell: r => formatCurrency(r.sales), exportValue: r => r.sales },
    { key: 'receipts', header: t('receipts'), align: 'end', sortable: true, cell: r => formatCurrency(r.receipts), exportValue: r => r.receipts },
    { key: 'debit', header: t('debit'), align: 'end', sortable: true, cell: r => formatCurrency(r.debit), exportValue: r => r.debit },
    { key: 'credit', header: t('credit'), align: 'end', sortable: true, cell: r => formatCurrency(r.credit), exportValue: r => r.credit },
    {
      key: 'balanced',
      header: t('balanced'),
      align: 'center',
      sortable: true,
      // Sorted by how far OUT of balance the year is, so the years that need
      // looking at come to the top — a boolean would bury the size of the gap.
      sortValue: r => Math.abs(r.debit - r.credit),
      cell: r => {
        const diff = r.debit - r.credit
        return Math.abs(diff) < 0.01 ? (
          <span className="text-emerald-600 dark:text-emerald-400">✓</span>
        ) : (
          <span className="text-red-600 dark:text-red-400">{formatCurrency(diff)}</span>
        )
      },
      exportValue: r => r.debit - r.credit,
    },
    {
      key: 'refreshed',
      header: t('refreshed'),
      hideOnMobile: true,
      sortable: true,
      sortValue: r => r.refreshed_at ?? '',
      cell: r => (
        <span className="text-xs text-muted-foreground">
          {r.refreshed_at ? formatDate(r.refreshed_at, 'datetime') : '—'}
        </span>
      ),
      exportValue: r => r.refreshed_at ?? '',
    },
  ]
}

function YearsInner() {
  useMoneyHidden()
  const scope = useBooksScope()
  const { t } = useBooksText()
  const { data, isLoading, error, refetch } = useBooksYears(true)

  if (error) return <ErrorState onRetry={() => refetch()} className="mt-6" />
  if (isLoading) return <Skeleton className="h-96 w-full" />

  // The totals and the per-year metadata arrive as two lists; join them once so
  // the table has one row shape rather than a lookup inside every cell.
  const meta = new Map<number, { state?: string; refreshed_at?: string | null }>(
    (data?.years ?? []).map((y: { year: number; state?: string; refreshed_at?: string | null }) => [y.year, y]),
  )
  const totals = [...(data?.totals ?? [])].map((r: Record<string, unknown>) => ({ ...r, year: Number(r.year) }))
  const rows: YearRow[] = (data?.totals ?? []).map((r: Record<string, unknown>) => {
    const year = Number(r.year)
    return {
      year,
      movements: Number(r.movements ?? 0),
      sales: Number(r.sales ?? 0),
      receipts: Number(r.receipts ?? 0),
      debit: Number(r.debit ?? 0),
      credit: Number(r.credit ?? 0),
      state: meta.get(year)?.state,
      refreshed_at: meta.get(year)?.refreshed_at ?? null,
    }
  })

  return (
    <div className="space-y-3">
      <YearsChart totals={totals} />
      <section className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
        <DataTable<YearRow>
          rows={rows}
          columns={buildColumns(t, scope.setYear)}
          getRowKey={r => r.year}
          // Newest year first — the same order the reversed list produced, now
          // stated rather than achieved by reversing.
          defaultSort={{ field: 'year', dir: 'desc' }}
          minWidth="min-w-[820px]"
          exportFileName="שנים"
          mobileCard={{
            title: r => formatId(r.year),
            subtitle: r => (r.state === 'live' ? t('live') : t('closedYear')),
            accent: r => formatCurrency(r.sales),
            fields: [{ label: t('movements'), value: r => formatId(r.movements) }],
          }}
        />
      </section>
      <p className="text-xs text-muted-foreground">
        שנים סגורות נטענות פעם אחת ואינן משתנות; השנה הפעילה נקראת מה-ERP ומתעדכנת שוב ושוב.
      </p>
    </div>
  )
}

export default function YearsPage() {
  return <Suspense fallback={<Skeleton className="h-96 w-full" />}><YearsInner /></Suspense>
}
