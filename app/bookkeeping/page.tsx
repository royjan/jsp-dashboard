'use client'

/**
 * סקירה — what the books say about the selected window, at a glance.
 *
 * The figures here all come from one server aggregate over the whole window,
 * so nothing on this page is a sample of a page of rows.
 */

import { Suspense } from 'react'
import { StatGrid, StatTile } from '@/components/shared/StatTile'
import { ErrorState } from '@/components/ui/feedback-state'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrency, formatCurrencyCompact, formatId } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useBooksOverview } from '@/hooks/use-books'
import { useBooksScope } from '@/components/books/use-books-scope'
import {
  AccountLink, BooksFilters, accountClassLabel, useBooksText,
} from '@/components/books/BooksChrome'
import { MonthlyFlowChart } from '@/components/books/BooksCharts'
import { BooksInsights } from '@/components/books/BooksInsights'
import { Sparkline } from '@/components/charts/kit'
import { CHART_PALETTE } from '@/lib/chart-colors'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'

/** One account in the "biggest balances" list. */
interface TopAccount {
  account: string
  name?: string
  class_code?: string
  movements: number
  balance: number
}

function OverviewInner() {
  useMoneyHidden()
  const scope = useBooksScope()
  const { t, lang } = useBooksText()
  const { data, isLoading, error, refetch } = useBooksOverview(scope.params as any)

  if (error) return <ErrorState onRetry={() => refetch()} className="mt-6" />

  const monthly = data?.monthly ?? []
  const totals = data?.totals ?? {}
  const sales = monthly.reduce((s: number, m: any) => s + Number(m.sales ?? 0), 0)
  const purchases = monthly.reduce((s: number, m: any) => s + Number(m.purchases ?? 0), 0)
  const diff = Number(totals.debit ?? 0) - Number(totals.credit ?? 0)

  return (
    <div className="space-y-4">
      <BooksFilters scope={scope} showDates />

      {isLoading ? <Skeleton className="h-28 w-full" /> : (
        <StatGrid columns={6}>
          <StatTile index={0} label={t('sales')} value={formatCurrencyCompact(sales)}
            hint={`${formatId(totals.movements ?? 0)} ${t('movements')}`} />
          <StatTile index={1} label={t('receipts')}
            value={formatCurrencyCompact(data?.cash?.total)}
            hint={`${formatId(data?.cash?.count ?? 0)} ${t('receipt')}`} />
          <StatTile index={2} label={t('purchases')} value={formatCurrencyCompact(purchases)} />
          <StatTile index={3} label={t('vatDue')} value={formatCurrencyCompact(data?.vat?.due)}
            higherIsBetter={false}
            hint={`${t('vatOut')} ${formatCurrencyCompact(data?.vat?.out)} · ${t('vatIn')} ${formatCurrencyCompact(data?.vat?.in)}`} />
          <StatTile index={4} label={t('debtors')}
            value={formatCurrencyCompact(data?.debtors?.total)}
            hint={`${formatId(data?.debtors?.count ?? 0)}`} />
          <StatTile index={5} label={t('booksBalance')}
            value={Math.abs(diff) < 0.01 ? t('inBalance') : formatCurrency(diff)}
            tone={Math.abs(diff) < 0.01 ? 'good' : 'bad'} />
        </StatGrid>
      )}

      <BooksInsights params={scope.params} />

      {isLoading ? <Skeleton className="h-72 w-full" /> : <MonthlyFlowChart months={monthly} />}

      <section className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
        <h2 className="mb-2 text-sm font-semibold">{t('biggestBalances')}</h2>
        <DataTable<TopAccount>
          rows={(data?.topAccounts ?? []) as TopAccount[]}
          columns={[
            {
              key: 'account',
              header: t('account'),
              sortable: true,
              cell: r => <AccountLink code={r.account} name={r.name} classCode={r.class_code} year={scope.year} />,
              exportValue: r => `${r.account} ${r.name ?? ''}`.trim(),
            },
            {
              key: 'class_code',
              header: t('balanceCode'),
              sortable: true,
              hideOnMobile: true,
              cell: r => (
                <span className="text-xs text-muted-foreground">
                  {accountClassLabel(r.class_code ?? '', lang) || r.class_code}
                </span>
              ),
              exportValue: r => accountClassLabel(r.class_code ?? '', lang) || r.class_code || '',
            },
            {
              key: 'movements',
              header: t('movements'),
              align: 'end',
              sortable: true,
              sortValue: r => Number(r.movements ?? 0),
              cell: r => formatId(r.movements),
              exportValue: r => Number(r.movements ?? 0),
            },
            {
              key: 'balance',
              header: t('balance'),
              align: 'end',
              sortable: true,
              sortValue: r => Number(r.balance ?? 0),
              cell: r => {
                const balance = Number(r.balance ?? 0)
                return (
                  <span className={balance < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>
                    {formatCurrency(balance)}
                  </span>
                )
              },
              exportValue: r => Number(r.balance ?? 0),
            },
          ] satisfies DataTableColumn<TopAccount>[]}
          getRowKey={r => r.account}
          loading={isLoading}
          minWidth="min-w-[560px]"
          exportFileName="יתרות-גדולות"
          mobileCard={{
            title: r => r.name || r.account,
            subtitle: r => r.account,
            accent: r => formatCurrency(Number(r.balance ?? 0)),
          }}
        />
      </section>

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <Sparkline points={monthly.map((m: any) => Number(m.sales ?? 0))}
          color={CHART_PALETTE[0]} />
        <span>{t('sales')} · {formatId(monthly.length)} {t('month')}</span>
      </div>
    </div>
  )
}

export default function BookkeepingOverviewPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <OverviewInner />
    </Suspense>
  )
}
