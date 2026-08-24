'use client'

/**
 * קופה — receipts, and the bank side around them.
 *
 * Five views share one route because they share one scope: switching between
 * קבלות and דפי בנק should not lose the year or the date window.
 */

import { Suspense, useMemo } from 'react'
import Link from 'next/link'
import { type DataTableColumn } from '@/components/shared/DataTable'
import { StatGrid, StatTile } from '@/components/shared/StatTile'
import { Skeleton } from '@/components/ui/skeleton'
import { Segmented } from '@/components/shared/filter-controls'
import { formatCurrency, formatCurrencyCompact, formatDate, formatId } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useBooksCash, useBooksCashTable } from '@/hooks/use-books'
import { useBooksScope } from '@/components/books/use-books-scope'
import { AccountLink, BooksFilters, useBooksText } from '@/components/books/BooksChrome'
import { BooksTable, BooksTotals } from '@/components/books/BooksTable'
import { ChequeTimeline, ReceiptsChart } from '@/components/books/BooksCharts'
import { PAY_TYPES } from '@/lib/books/strings'

type View = 'receipts' | 'banks' | 'cheques' | 'payments' | 'orders'

function ReceiptsView({ scope }: { scope: ReturnType<typeof useBooksScope> }) {
  useMoneyHidden()
  const { t, lang } = useBooksText()
  const { data, isLoading, error, refetch } = useBooksCash(scope.params as any)

  const columns = useMemo<DataTableColumn<any>[]>(() => [
    { key: 'number', header: t('receiptNumber'), sortable: true,
      cell: (r) => <Link href={`/bookkeeping/cash/${encodeURIComponent(r.number)}?year=${scope.year}`}
        className="font-mono text-xs text-primary hover:underline">{r.number}</Link> },
    { key: 'date', header: t('date'), sortable: true, cell: (r) => formatDate(r.date) },
    { key: 'account', header: t('account'), sortable: true,
      cell: (r) => <AccountLink code={r.account} year={scope.year} showName={false} /> },
    { key: 'name', header: t('accountName'), sortable: true, truncate: 'max-w-[260px]',
      cell: (r) => <span dir="auto">{r.name}</span>, title: (r) => r.name },
    { key: 'lines', header: t('lines'), align: 'end', sortable: true,
      cell: (r) => formatId(r.lines) },
    { key: 'amount', header: t('amount'), align: 'end', sortable: true,
      cell: (r) => formatCurrency(Number(r.amount)) },
    { key: 'time', header: t('time'), hideOnMobile: true,
      cell: (r) => <span className="font-mono text-xs text-muted-foreground">{r.time}</span> },
  ], [t, scope.year])

  const mix = (data?.mix ?? []).slice(0, 4)

  return (
    <div className="space-y-3">
      {isLoading ? <Skeleton className="h-24 w-full" /> : (
        <StatGrid columns={6}>
          <StatTile index={0} label={t('receipts')} value={formatId(data?.summary?.count ?? 0)} />
          <StatTile index={1} label={t('total')}
            value={formatCurrencyCompact(data?.summary?.total)} />
          {mix.map((m: any, i: number) => (
            <StatTile key={m.pay_type} index={i + 2}
              label={PAY_TYPES[m.pay_type]?.[lang] ?? `${t('tender')} ${m.pay_type}`}
              value={formatCurrencyCompact(m.total)}
              hint={`${formatId(m.count)} ${t('lines')}`} />
          ))}
        </StatGrid>
      )}

      {!isLoading && <ReceiptsChart months={data?.monthly ?? []} />}
      {!isLoading && <ChequeTimeline cheques={data?.upcomingCheques ?? []} />}

      <BooksTable
        columns={columns} rows={data?.rows ?? []} total={data?.total ?? 0}
        scope={scope} loading={isLoading} error={error} onRetry={() => refetch()}
        getRowKey={(r) => r.number} emptyLabel={t('noRows')}
        footer={data?.summary ? (
          <BooksTotals items={[
            { label: t('receipts'), value: formatId(data.summary.count) },
            { label: t('total'), value: formatCurrency(data.summary.total) },
          ]} />
        ) : null}
      />
    </div>
  )
}

function BankView({ scope, view }: { scope: ReturnType<typeof useBooksScope>; view: View }) {
  useMoneyHidden()
  const { t } = useBooksText()
  const account = scope.get('account') ?? undefined
  const { data, isLoading, error, refetch } = useBooksCashTable({
    ...scope.params, table: view, account,
  } as any)

  const columns = useMemo<DataTableColumn<any>[]>(() => {
    const base: DataTableColumn<any>[] = [
      { key: 'date', header: view === 'cheques' ? t('dueDate') : t('date'), sortable: true,
        cell: (r) => formatDate(view === 'cheques' ? r.due_date : r.date) },
    ]
    if (view !== 'orders') {
      base.push({ key: 'bank', header: t('bank'), hideOnMobile: true,
        cell: (r) => <span className="font-mono text-xs">{r.bank_account}</span> })
    }
    if (view === 'banks' || view === 'payments') {
      base.push({ key: 'page', header: t('page'), hideOnMobile: true,
        cell: (r) => <span className="font-mono text-xs">{r.page}</span> })
    }
    base.push(
      { key: 'reference', header: t('reference'), sortable: true,
        cell: (r) => <span className="font-mono text-xs">{r.reference ?? r.number}</span> },
      { key: 'account', header: t('account'), sortable: true,
        cell: (r) => r.account
          ? <AccountLink code={r.account} year={scope.year} showName={false} /> : null },
      { key: 'name', header: t('accountName'), truncate: 'max-w-[240px]',
        cell: (r) => <span dir="auto">{r.account_name}</span> },
      { key: 'detail', header: t('detail'), sortable: true, truncate: 'max-w-[220px]',
        cell: (r) => <span dir="auto">{r.detail}</span>, title: (r) => r.detail },
      { key: 'amount', header: t('amount'), align: 'end', sortable: true,
        cell: (r) => formatCurrency(Number(r.amount)) },
    )
    if (view === 'banks') {
      base.push({ key: 'balance', header: t('balance'), align: 'end',
        cell: (r) => formatCurrency(Number(r.balance)) })
    }
    return base
  }, [t, view, scope.year])

  return (
    <div className="space-y-3">
      {view !== 'orders' && (data?.bankAccounts ?? []).length > 0 && (
        <Segmented
          label={t('bank')}
          value={account ?? null}
          options={[{ value: null, label: t('allTypes') },
            ...(data?.bankAccounts ?? []).map((b: any) => ({
              value: b.bank_account, label: `${t('account')} ${b.bank_account}` }))]}
          onChange={(v) => scope.set({ account: v, page: null })}
        />
      )}
      <BooksTable
        columns={columns} rows={data?.rows ?? []} total={data?.total ?? 0}
        scope={scope} loading={isLoading} error={error} onRetry={() => refetch()}
        getRowKey={(r, i) => r.fp ?? `${r.number ?? r.page}-${i}`} emptyLabel={t('noRows')}
        footer={data?.summary ? (
          <BooksTotals items={[
            { label: t('lines'), value: formatId(data.summary.count) },
            { label: t('total'), value: formatCurrency(data.summary.total) },
          ]} />
        ) : null}
      />
    </div>
  )
}

function CashInner() {
  const scope = useBooksScope('date')
  const { t } = useBooksText()
  const view = (scope.get('view') ?? 'receipts') as View

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<View>
          label=""
          value={view}
          options={[
            { value: 'receipts', label: t('receipt') },
            { value: 'banks', label: t('banks') },
            { value: 'cheques', label: t('cheques') },
            { value: 'payments', label: t('payments') },
            { value: 'orders', label: t('orders') },
          ]}
          onChange={(v) => scope.set({ view: v === 'receipts' ? null : v, page: null })}
        />
      </div>
      <BooksFilters scope={scope} searchPlaceholder={`${t('receiptNumber')} / ${t('accountName')}`} />
      {view === 'receipts'
        ? <ReceiptsView scope={scope} />
        : <BankView scope={scope} view={view} />}
    </div>
  )
}

export default function CashPage() {
  return <Suspense fallback={<Skeleton className="h-96 w-full" />}><CashInner /></Suspense>
}
