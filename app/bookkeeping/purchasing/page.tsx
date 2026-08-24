'use client'

/** רכש — supplier documents as the books record them, and supplier balances. */

import { Suspense, useMemo } from 'react'
import { type DataTableColumn } from '@/components/shared/DataTable'
import { StatGrid, StatTile } from '@/components/shared/StatTile'
import { Skeleton } from '@/components/ui/skeleton'
import { Segmented } from '@/components/shared/filter-controls'
import { formatCurrency, formatCurrencyCompact, formatDate, formatId } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useBooksPurchasing, useBooksSuppliers } from '@/hooks/use-books'
import { useBooksScope } from '@/components/books/use-books-scope'
import {
  AccountLink, BooksFilters, RefLink, docTypeLabel, useBooksText,
} from '@/components/books/BooksChrome'
import { BooksTable, BooksTotals } from '@/components/books/BooksTable'
import { ReceiptsChart } from '@/components/books/BooksCharts'

function DocumentsView({ scope }: { scope: ReturnType<typeof useBooksScope> }) {
  useMoneyHidden()
  const { t, lang } = useBooksText()
  const kind = scope.get('kind') ?? undefined
  const { data, isLoading, error, refetch } = useBooksPurchasing({ ...scope.params, kind } as any)

  const columns = useMemo<DataTableColumn<any>[]>(() => [
    { key: 'date', header: t('date'), sortable: true, cell: (r) => formatDate(r.date) },
    { key: 'ref', header: t('reference'), sortable: true,
      cell: (r) => <RefLink refCode={r.ref1} year={scope.year} /> },
    { key: 'type', header: t('docType'),
      cell: (r) => <span className="text-xs text-muted-foreground">
        {docTypeLabel(r.ref1, lang)}</span> },
    { key: 'supplier', header: t('supplier'), truncate: 'max-w-[240px]',
      cell: (r) => r.supplier
        ? <AccountLink code={r.supplier} classCode="431" year={scope.year} showName={false} />
        : null },
    { key: 'detail', header: t('detail'), sortable: true, truncate: 'max-w-[280px]',
      cell: (r) => <span dir="auto">{r.detail}</span>, title: (r) => r.detail },
    { key: 'lines', header: t('lines'), align: 'end', sortable: true,
      cell: (r) => formatId(r.lines) },
    { key: 'debit', header: t('debit'), align: 'end', sortable: true,
      cell: (r) => formatCurrency(Number(r.debit)) },
    { key: 'credit', header: t('credit'), align: 'end', sortable: true,
      cell: (r) => formatCurrency(Number(r.credit)) },
  ], [t, lang, scope.year])

  return (
    <div className="space-y-3">
      {isLoading ? <Skeleton className="h-24 w-full" /> : (
        <StatGrid columns={Math.min(Math.max((data?.byKind ?? []).length, 2), 6) as any}>
          {(data?.byKind ?? []).map((k: any, i: number) => (
            <StatTile key={k.kind} index={i}
              label={docTypeLabel(k.kind, lang) || k.kind}
              value={formatCurrencyCompact(k.debit)}
              hint={`${formatId(k.documents)}`}
              onClick={() => scope.set({ kind: kind === k.kind ? null : k.kind, page: null })} />
          ))}
        </StatGrid>
      )}

      {!isLoading && (data?.monthly ?? []).length > 0 && (
        <ReceiptsChart months={(data?.monthly ?? []).map((m: any) => ({
          month: m.month, total: m.purchases, count: m.documents,
        }))} />
      )}

      <BooksTable
        columns={columns} rows={data?.rows ?? []} total={data?.total ?? 0}
        scope={scope} loading={isLoading} error={error} onRetry={() => refetch()}
        getRowKey={(r) => r.ref1} emptyLabel={t('noRows')}
      />
    </div>
  )
}

function SuppliersView({ scope }: { scope: ReturnType<typeof useBooksScope> }) {
  useMoneyHidden()
  const { t } = useBooksText()
  const { data, isLoading, error, refetch } = useBooksSuppliers(scope.params as any)

  const columns = useMemo<DataTableColumn<any>[]>(() => [
    { key: 'code', header: t('supplier'), sortable: true,
      cell: (r) => <AccountLink code={r.code} classCode="431" year={scope.year} showName={false} /> },
    { key: 'name', header: t('accountName'), sortable: true, truncate: 'max-w-[280px]',
      cell: (r) => <span dir="auto">{r.name}</span>, title: (r) => r.name },
    { key: 'city', header: t('city'), hideOnMobile: true, cell: (r) => r.city },
    { key: 'movements', header: t('movements'), align: 'end', sortable: true,
      cell: (r) => formatId(r.movements) },
    { key: 'last', header: t('lastMovement'), sortable: true,
      cell: (r) => formatDate(r.last_movement) },
    { key: 'debit', header: t('debit'), align: 'end', sortable: true,
      cell: (r) => formatCurrency(Number(r.debit)) },
    { key: 'credit', header: t('credit'), align: 'end', sortable: true,
      cell: (r) => formatCurrency(Number(r.credit)) },
    { key: 'balance', header: t('balance'), align: 'end', sortable: true,
      cell: (r) => {
        const n = Number(r.balance ?? 0)
        return <span className={n > 0.005 ? 'text-red-600 dark:text-red-400' : ''}>
          {formatCurrency(n)}</span>
      } },
  ], [t, scope.year])

  const owed = (data?.rows ?? []).reduce((s: number, r: any) => s + Number(r.balance ?? 0), 0)

  return (
    <BooksTable
      columns={columns} rows={data?.rows ?? []} total={data?.total ?? 0}
      scope={scope} loading={isLoading} error={error} onRetry={() => refetch()}
      getRowKey={(r) => r.code} emptyLabel={t('noRows')}
      footer={<BooksTotals items={[
        { label: t('suppliers'), value: formatId(data?.total ?? 0) },
        { label: t('balance'), value: formatCurrency(owed), tone: 'bad' },
      ]} />}
    />
  )
}

function PurchasingInner() {
  const scope = useBooksScope('date')
  const { t } = useBooksText()
  const view = scope.get('view') === 'suppliers' ? 'suppliers' : 'documents'

  return (
    <div className="space-y-3">
      <Segmented<'documents' | 'suppliers'>
        label=""
        value={view}
        options={[
          { value: 'documents', label: t('purchasing') },
          { value: 'suppliers', label: t('suppliers') },
        ]}
        onChange={(v) => scope.set({ view: v === 'documents' ? null : v, page: null })}
      />
      <BooksFilters scope={scope} searchPlaceholder={`${t('supplier')} / ${t('reference')}`} />
      {view === 'documents' ? <DocumentsView scope={scope} /> : <SuppliersView scope={scope} />}
    </div>
  )
}

export default function PurchasingPage() {
  return <Suspense fallback={<Skeleton className="h-96 w-full" />}><PurchasingInner /></Suspense>
}
