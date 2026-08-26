'use client'

/** מע״מ — the period as the return reads it: turnover, output, input, payable. */

import { Suspense } from 'react'
import { StatGrid, StatTile } from '@/components/shared/StatTile'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/feedback-state'
import { formatCurrency, formatCurrencyCompact, formatId } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useBooksVat } from '@/hooks/use-books'
import { useBooksScope } from '@/components/books/use-books-scope'
import { AccountLink, BooksFilters, useBooksText } from '@/components/books/BooksChrome'
import { VatChart } from '@/components/books/BooksCharts'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'

interface VatMonth {
  month: string
  movements: number
  turnover: number | string
  vat_out: number | string
  vat_in: number | string
  due: number | string
}

interface VatAccount {
  account: string
  name: string
  movements: number
  debit: number | string
  credit: number | string
}

const num = (v: number | string) => Number(v) || 0

type BooksT = ReturnType<typeof useBooksText>['t']

const MONTH_COLUMNS = (t: BooksT): DataTableColumn<VatMonth>[] => [
  { key: 'month', header: t('month'), sortable: true, cell: m => m.month, cellClassName: 'font-mono text-xs' },
  { key: 'movements', header: t('movements'), align: 'end', sortable: true,
    cell: m => formatId(m.movements), exportValue: m => m.movements },
  { key: 'turnover', header: t('turnover'), align: 'end', sortable: true,
    cell: m => formatCurrency(num(m.turnover)), exportValue: m => num(m.turnover), sortValue: m => num(m.turnover) },
  { key: 'vat_out', header: t('vatOut'), align: 'end', sortable: true,
    cell: m => formatCurrency(num(m.vat_out)), exportValue: m => num(m.vat_out), sortValue: m => num(m.vat_out) },
  { key: 'vat_in', header: t('vatIn'), align: 'end', sortable: true,
    cell: m => formatCurrency(num(m.vat_in)), exportValue: m => num(m.vat_in), sortValue: m => num(m.vat_in) },
  { key: 'due', header: t('vatDue'), align: 'end', sortable: true,
    cell: m => formatCurrency(num(m.due)), exportValue: m => num(m.due), sortValue: m => num(m.due),
    cellClassName: 'font-semibold' },
]

const ACCOUNT_COLUMNS = (t: BooksT, year: number | string): DataTableColumn<VatAccount>[] => [
  { key: 'account', header: t('account'), sortable: true,
    cell: r => <AccountLink code={r.account} year={year as never} showName={false} />,
    exportValue: r => r.account },
  { key: 'name', header: t('accountName'), sortable: true, truncate: true,
    title: r => r.name, cell: r => <span dir="auto">{r.name}</span>, exportValue: r => r.name },
  { key: 'movements', header: t('movements'), align: 'end', sortable: true,
    cell: r => formatId(r.movements), exportValue: r => r.movements },
  { key: 'debit', header: t('debit'), align: 'end', sortable: true,
    cell: r => formatCurrency(num(r.debit)), exportValue: r => num(r.debit), sortValue: r => num(r.debit) },
  { key: 'credit', header: t('credit'), align: 'end', sortable: true,
    cell: r => formatCurrency(num(r.credit)), exportValue: r => num(r.credit), sortValue: r => num(r.credit) },
]

function VatInner() {
  useMoneyHidden()
  const scope = useBooksScope()
  const { t } = useBooksText()
  const { data, isLoading, error, refetch } = useBooksVat(scope.params as any)

  if (error) return <ErrorState onRetry={() => refetch()} className="mt-6" />
  const s = data?.summary
  // The old markup did [...months].reverse() inline — newest first is what the
  // return is read in. DataTable sorts by column now, so this is only the
  // arrival order.
  const months = [...((data?.months ?? []) as VatMonth[])].reverse()

  return (
    <div className="space-y-3">
      <BooksFilters scope={scope} showDates searchPlaceholder={t('search')} />

      {isLoading ? <Skeleton className="h-24 w-full" /> : (
        <StatGrid columns={4}>
          <StatTile index={0} label={t('turnover')} value={formatCurrencyCompact(s?.turnover)} />
          <StatTile index={1} label={t('vatOut')} value={formatCurrencyCompact(s?.vat_out)} />
          <StatTile index={2} label={t('vatIn')} value={formatCurrencyCompact(s?.vat_in)} />
          <StatTile index={3} label={t('vatDue')} value={formatCurrencyCompact(s?.due)}
            higherIsBetter={false} tone="warn" />
        </StatGrid>
      )}

      {!isLoading && <VatChart months={data?.months ?? []} />}

      <section className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
        {/* The footer sums the WHOLE period from the API summary, not the visible
            page: a VAT return is filed on the period total, and a total that
            quietly followed the pager would be the more believable wrong number. */}
        <DataTable
          rows={months}
          columns={MONTH_COLUMNS(t)}
          getRowKey={m => m.month}
          minWidth="min-w-[620px]"
          exportFileName="מעמ-לפי-חודש"
          footer={() =>
            s ? (
              <tr>
                <td className="py-2 pe-4">{t('total')}</td>
                <td />
                <td className="py-2 pe-4 text-end tabular-nums">{formatCurrency(s.turnover)}</td>
                <td className="py-2 pe-4 text-end tabular-nums">{formatCurrency(s.vat_out)}</td>
                <td className="py-2 pe-4 text-end tabular-nums">{formatCurrency(s.vat_in)}</td>
                <td className="py-2 text-end tabular-nums">{formatCurrency(s.due)}</td>
              </tr>
            ) : null
          }
          mobileCard={{
            title: m => m.month,
            accent: m => formatCurrency(num(m.due)),
            fields: [
              { label: t('turnover'), value: m => formatCurrency(num(m.turnover)) },
              { label: t('vatOut'), value: m => formatCurrency(num(m.vat_out)) },
              { label: t('vatIn'), value: m => formatCurrency(num(m.vat_in)) },
            ],
          }}
        />
      </section>

      <section className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
        <h2 className="mb-2 text-sm font-semibold">{t('account')}</h2>
        <DataTable
          rows={(data?.byAccount ?? []) as VatAccount[]}
          columns={ACCOUNT_COLUMNS(t, scope.year)}
          getRowKey={r => r.account}
          minWidth="min-w-[560px]"
          pageSize={25}
          exportFileName="מעמ-לפי-חשבון"
          mobileCard={{
            title: r => r.name,
            subtitle: r => r.account,
            accent: r => formatCurrency(num(r.debit)),
            fields: [{ label: t('credit'), value: r => formatCurrency(num(r.credit)) }],
          }}
        />
        <p className="mt-2 text-xs text-muted-foreground">
          מקור: קובץ תנועות המע״מ של ה-ERP. פקודות יומן ידניות שלא נרשמו בקובץ המע״מ
          אינן מופיעות כאן, אך כן מופיעות בכרטסת.
        </p>
      </section>
    </div>
  )
}

export default function VatPage() {
  return <Suspense fallback={<Skeleton className="h-96 w-full" />}><VatInner /></Suspense>
}
