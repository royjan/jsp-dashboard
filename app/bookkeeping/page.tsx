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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="pb-2 pe-4 text-start">{t('account')}</th>
                <th className="pb-2 pe-4 text-start">{t('balanceCode')}</th>
                <th className="pb-2 pe-4 text-end">{t('movements')}</th>
                <th className="pb-2 text-end">{t('balance')}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.topAccounts ?? []).map((row: any) => {
                const balance = Number(row.balance ?? 0)
                return (
                  <tr key={row.account} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-1.5 pe-4">
                      <AccountLink code={row.account} name={row.name}
                        classCode={row.class_code} year={scope.year} />
                    </td>
                    <td className="py-1.5 pe-4 text-xs text-muted-foreground">
                      {accountClassLabel(row.class_code, lang) || row.class_code}
                    </td>
                    <td className="py-1.5 pe-4 text-end tabular-nums">
                      {formatId(row.movements)}
                    </td>
                    <td className={`py-1.5 text-end tabular-nums ${
                      balance < 0 ? 'text-red-600 dark:text-red-400'
                                  : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {formatCurrency(balance)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
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
