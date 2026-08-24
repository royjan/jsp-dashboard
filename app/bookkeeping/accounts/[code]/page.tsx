'use client'

/** כרטסת — one account's movements, with the balance running through them. */

import { Suspense, use, useMemo } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { type DataTableColumn } from '@/components/shared/DataTable'
import { StatGrid, StatTile } from '@/components/shared/StatTile'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/feedback-state'
import { formatCurrency, formatCurrencyCompact, formatDate, formatId } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useLedgerCard } from '@/hooks/use-books'
import { useBooksScope } from '@/components/books/use-books-scope'
import {
  AccountLink, BooksFilters, RefLink, accountClassLabel, docTypeLabel, operationalHref,
  useBooksText,
} from '@/components/books/BooksChrome'
import { BooksTable, BooksTotals } from '@/components/books/BooksTable'
import { BalanceAreaChart } from '@/components/books/BooksCharts'

function LedgerCardInner({ code }: { code: string }) {
  useMoneyHidden()
  const scope = useBooksScope('date')
  const { t, lang } = useBooksText()
  const { data, isLoading, error, refetch } = useLedgerCard(code, scope.params as any)

  const columns = useMemo<DataTableColumn<any>[]>(() => [
    { key: 'date', header: t('date'), sortable: true,
      cell: (r) => formatDate(r.doc_date) },
    { key: 'pay', header: t('payDate'), sortable: true, hideOnMobile: true,
      cell: (r) => formatDate(r.pay_date) },
    { key: 'ref', header: t('reference'), sortable: true,
      cell: (r) => <RefLink refCode={r.ref1} year={scope.year} /> },
    { key: 'type', header: t('docType'), hideOnMobile: true,
      cell: (r) => <span className="text-xs text-muted-foreground">
        {docTypeLabel(r.ref1, lang)}</span> },
    { key: 'detail', header: t('detail'), sortable: true, truncate: 'max-w-[280px]',
      cell: (r) => <span dir="auto">{r.detail}</span>, title: (r) => r.detail },
    { key: 'counter', header: t('counterAccount'), sortable: true, truncate: 'max-w-[220px]',
      cell: (r) => <AccountLink code={r.counter_account} name={r.counter_name}
        classCode={r.counter_class} year={scope.year} /> },
    { key: 'debit', header: t('debit'), align: 'end', sortable: true,
      cell: (r) => formatCurrency(Number(r.debit)) },
    { key: 'credit', header: t('credit'), align: 'end', sortable: true,
      cell: (r) => formatCurrency(Number(r.credit)) },
    { key: 'balance', header: t('balance'), align: 'end',
      cell: (r) => {
        const n = Number(r.balance ?? 0)
        return <span className={n < 0 ? 'text-red-600 dark:text-red-400'
          : 'text-emerald-600 dark:text-emerald-400'}>{formatCurrency(n)}</span>
      } },
  ], [t, lang, scope.year])

  if (error) return <ErrorState onRetry={() => refetch()} className="mt-6" />

  const account = data?.account
  const summary = data?.summary
  const external = operationalHref(code, account?.class_code)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/bookkeeping/accounts?year=${scope.year}`}
              className="hover:text-foreground">{t('accounts')}</Link>
        <ArrowRight className="h-3 w-3 rotate-180" />
        <span className="text-foreground" dir="auto">
          {formatId(code)} {account?.name ?? ''}
        </span>
        {account?.class_code && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
            {account.class_code} {accountClassLabel(account.class_code, lang)}
          </span>
        )}
        {external && (
          <Link href={external}
                className="ms-auto rounded-lg border px-3 py-1.5 text-sm text-primary hover:bg-accent">
            {t('openInDashboard')} ↗
          </Link>
        )}
      </div>

      {isLoading ? <Skeleton className="h-24 w-full" /> : (
        <StatGrid columns={4}>
          <StatTile index={0} label={t('debit')} value={formatCurrencyCompact(summary?.debit)} />
          <StatTile index={1} label={t('credit')} value={formatCurrencyCompact(summary?.credit)} />
          <StatTile index={2} label={t('balance')}
            value={formatCurrencyCompact(summary?.balance)}
            tone={Number(summary?.balance ?? 0) < 0 ? 'bad' : 'good'} />
          <StatTile index={3} label={t('movements')} value={formatId(summary?.movements ?? 0)}
            hint={`${t('opening')}: ${formatCurrency(data?.opening ?? 0)}`} />
        </StatGrid>
      )}

      <BooksFilters scope={scope} searchPlaceholder={`${t('detail')} / ${t('reference')}`} />

      {!isLoading && <BalanceAreaChart rows={data?.rows ?? []} opening={data?.opening ?? 0} />}

      <BooksTable
        columns={columns} rows={data?.rows ?? []} total={data?.total ?? data?.rows?.length ?? 0}
        scope={scope} loading={isLoading} error={error} onRetry={() => refetch()}
        getRowKey={(r, i) => `${r.ref1}-${r.sequence}-${i}`} emptyLabel={t('noRows')}
        footer={summary ? (
          <BooksTotals items={[
            { label: t('debit'), value: formatCurrency(summary.debit) },
            { label: t('credit'), value: formatCurrency(summary.credit) },
            { label: t('balance'), value: formatCurrency(summary.balance),
              tone: summary.balance < 0 ? 'bad' : 'good' },
          ]} />
        ) : null}
      />
    </div>
  )
}

export default function LedgerCardPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <LedgerCardInner code={decodeURIComponent(code)} />
    </Suspense>
  )
}
