'use client'

/** מאזן בוחן — every account's two sides, and the proof they agree. */

import { Suspense, useMemo } from 'react'
import { type DataTableColumn } from '@/components/shared/DataTable'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrency, formatId } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useBooksTrialBalance } from '@/hooks/use-books'
import { useBooksScope } from '@/components/books/use-books-scope'
import { AccountLink, BooksFilters, accountClassLabel, useBooksText } from '@/components/books/BooksChrome'
import { BooksTable, BooksTotals } from '@/components/books/BooksTable'
import { Sparkline } from '@/components/charts/kit'
import { CHART_SEMANTIC } from '@/lib/chart-colors'

function TrialBalanceInner() {
  useMoneyHidden()
  const scope = useBooksScope('balance')
  const { t, lang } = useBooksText()
  const includeZero = scope.get('zero') === '1'
  const { data, isLoading, error, refetch } = useBooksTrialBalance({
    ...scope.params, zero: includeZero ? '1' : undefined,
  } as any)

  const peak = useMemo(() => Math.max(
    1, ...(data?.rows ?? []).map((r: any) => Math.abs(Number(r.balance ?? 0)))), [data])

  const columns = useMemo<DataTableColumn<any>[]>(() => [
    { key: 'code', header: t('account'), sortable: true,
      cell: (r) => <AccountLink code={r.account} classCode={r.class_code} year={scope.year} showName={false} /> },
    { key: 'name', header: t('accountName'), sortable: true, truncate: 'max-w-[260px]',
      cell: (r) => <span dir="auto">{r.name}</span>, title: (r) => r.name },
    { key: 'class', header: t('balanceCode'), sortable: true,
      cell: (r) => <span className="text-xs text-muted-foreground">
        {r.class_code} {accountClassLabel(r.class_code, lang)}</span> },
    { key: 'shape', header: '', cell: (r) => {
        // Two bars around zero: how this account's debit and credit compare to
        // the largest balance on the page.
        const balance = Number(r.balance ?? 0)
        return <Sparkline points={[0, balance / peak]} width={56} height={16}
          color={balance < 0 ? CHART_SEMANTIC.bad : CHART_SEMANTIC.good} />
      } },
    { key: 'movements', header: t('movements'), align: 'end', sortable: true,
      cell: (r) => formatId(r.movements) },
    { key: 'debit', header: t('debit'), align: 'end', sortable: true,
      cell: (r) => formatCurrency(Number(r.debit)) },
    { key: 'credit', header: t('credit'), align: 'end', sortable: true,
      cell: (r) => formatCurrency(Number(r.credit)) },
    { key: 'balance', header: t('balance'), align: 'end', sortable: true,
      cell: (r) => {
        const n = Number(r.balance ?? 0)
        return <span className={n < 0 ? 'text-red-600 dark:text-red-400'
          : 'text-emerald-600 dark:text-emerald-400'}>{formatCurrency(n)}</span>
      } },
  ], [t, lang, scope.year, peak])

  const summary = data?.summary
  return (
    <div className="space-y-3">
      <BooksFilters scope={scope} searchPlaceholder={`${t('account')} / ${t('accountName')}`}>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={includeZero}
            onChange={(e) => scope.set({ zero: e.target.checked ? '1' : null, page: null })} />
          {t('includeZero')}
        </label>
      </BooksFilters>
      <BooksTable
        columns={columns} rows={data?.rows ?? []} total={data?.total ?? 0}
        scope={scope} loading={isLoading} error={error} onRetry={() => refetch()}
        getRowKey={(r) => r.account} emptyLabel={t('noRows')}
        footer={summary ? (
          <BooksTotals items={[
            { label: t('movements'), value: formatId(summary.accounts) },
            { label: t('debit'), value: formatCurrency(summary.debit) },
            { label: t('credit'), value: formatCurrency(summary.credit) },
            { label: t('balanced'),
              value: Math.abs(summary.diff) < 0.01 ? '✓' : formatCurrency(summary.diff),
              tone: Math.abs(summary.diff) < 0.01 ? 'good' : 'bad' },
          ]} />
        ) : null}
      />
    </div>
  )
}

export default function TrialBalancePage() {
  return <Suspense fallback={<Skeleton className="h-96 w-full" />}><TrialBalanceInner /></Suspense>
}
