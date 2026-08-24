'use client'

/** אינדקס הנהח״ש — every card in the books, with its movement in the window. */

import { Suspense, useMemo } from 'react'
import { type DataTableColumn } from '@/components/shared/DataTable'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrency, formatId } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useBooksAccounts } from '@/hooks/use-books'
import { useBooksScope } from '@/components/books/use-books-scope'
import { AccountLink, BooksFilters, accountClassLabel, useBooksText } from '@/components/books/BooksChrome'
import { BooksTable } from '@/components/books/BooksTable'

function Money({ value }: { value: number }) {
  useMoneyHidden()
  const n = Number(value ?? 0)
  return <span className={n < -0.005 ? 'text-red-600 dark:text-red-400'
    : n > 0.005 ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}>
    {formatCurrency(n)}
  </span>
}

function AccountsInner() {
  const scope = useBooksScope('balance')
  const { t, lang } = useBooksText()
  const classCode = scope.params.class as string | undefined
  const { data, isLoading, error, refetch } = useBooksAccounts({
    ...scope.params, class: classCode,
  } as any)

  const columns = useMemo<DataTableColumn<any>[]>(() => [
    { key: 'code', header: t('account'), sortable: true,
      cell: (r) => <AccountLink code={r.code} classCode={r.class_code} year={scope.year} showName={false} /> },
    { key: 'name', header: t('accountName'), sortable: true, truncate: 'max-w-[280px]',
      cell: (r) => <span dir="auto">{r.name}</span>, title: (r) => r.name },
    { key: 'class', header: t('balanceCode'), sortable: true,
      cell: (r) => <span className="text-xs text-muted-foreground">
        {r.class_code} {accountClassLabel(r.class_code, lang)}</span> },
    { key: 'city', header: t('city'), sortable: true, cell: (r) => r.city },
    { key: 'taxId', header: t('taxId'), cell: (r) => <span className="font-mono text-xs">{r.tax_id}</span> },
    { key: 'movements', header: t('movements'), align: 'end', sortable: true,
      cell: (r) => formatId(r.movements) },
    { key: 'debit', header: t('debit'), align: 'end', sortable: true,
      cell: (r) => formatCurrency(Number(r.debit)) },
    { key: 'credit', header: t('credit'), align: 'end', sortable: true,
      cell: (r) => formatCurrency(Number(r.credit)) },
    { key: 'balance', header: t('balance'), align: 'end', sortable: true,
      cell: (r) => <Money value={Number(r.balance)} /> },
  ], [t, lang, scope.year])

  return (
    <div className="space-y-3">
      <BooksFilters scope={scope} searchPlaceholder={`${t('account')} / ${t('accountName')} / ${t('taxId')}`}>
        <select
          value={classCode ?? ''}
          onChange={(e) => scope.set({ class: e.target.value || null, page: null })}
          className="h-9 rounded-lg border bg-card px-2 text-sm"
        >
          <option value="">{t('allAccounts')}</option>
          {(data?.classes ?? []).map((c: any) => (
            <option key={c.class_code} value={c.class_code}>
              {c.class_code} {accountClassLabel(c.class_code, lang)} ({c.n})
            </option>
          ))}
        </select>
      </BooksFilters>
      <BooksTable
        columns={columns} rows={data?.rows ?? []} total={data?.total ?? 0}
        scope={scope} loading={isLoading} error={error} onRetry={() => refetch()}
        getRowKey={(r) => r.code} emptyLabel={t('noRows')}
      />
    </div>
  )
}

export default function BookkeepingAccountsPage() {
  return <Suspense fallback={<Skeleton className="h-96 w-full" />}><AccountsInner /></Suspense>
}
