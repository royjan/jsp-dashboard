'use client'

/** פקודות יומן — every document and entry, grouped by its reference. */

import { Suspense, useMemo } from 'react'
import { type DataTableColumn } from '@/components/shared/DataTable'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrency, formatDate, formatId } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useBooksJournal } from '@/hooks/use-books'
import { useBooksScope } from '@/components/books/use-books-scope'
import { BooksFilters, RefLink, docTypeLabel, useBooksText } from '@/components/books/BooksChrome'
import { BooksTable } from '@/components/books/BooksTable'

function JournalInner() {
  useMoneyHidden()
  const scope = useBooksScope('date')
  const { t, lang } = useBooksText()
  const kind = scope.get('kind') ?? undefined
  const { data, isLoading, error, refetch } = useBooksJournal({ ...scope.params, kind } as any)

  const columns = useMemo<DataTableColumn<any>[]>(() => [
    { key: 'date', header: t('date'), sortable: true, cell: (r) => formatDate(r.date) },
    { key: 'ref', header: t('reference'), sortable: true,
      cell: (r) => <RefLink refCode={r.ref1} year={scope.year} /> },
    { key: 'type', header: t('docType'),
      cell: (r) => <span className="text-xs text-muted-foreground">
        {docTypeLabel(r.ref1, lang)}</span> },
    { key: 'entry', header: t('entryNumber'), hideOnMobile: true,
      cell: (r) => <span className="font-mono text-xs">{r.order_num}</span> },
    { key: 'lines', header: t('lines'), align: 'end', sortable: true,
      cell: (r) => formatId(r.lines) },
    { key: 'detail', header: t('detail'), sortable: true, truncate: 'max-w-[320px]',
      cell: (r) => <span dir="auto">{r.detail}</span>, title: (r) => r.detail },
    { key: 'debit', header: t('debit'), align: 'end', sortable: true,
      cell: (r) => formatCurrency(Number(r.debit)) },
    { key: 'credit', header: t('credit'), align: 'end', sortable: true,
      cell: (r) => formatCurrency(Number(r.credit)) },
    { key: 'balanced', header: t('balanced'), align: 'center',
      cell: (r) => {
        const diff = Number(r.debit ?? 0) - Number(r.credit ?? 0)
        return Math.abs(diff) < 0.005
          ? <span className="text-emerald-600 dark:text-emerald-400">✓</span>
          : <span className="text-red-600 tabular-nums dark:text-red-400">{formatCurrency(diff)}</span>
      } },
  ], [t, lang, scope.year])

  return (
    <div className="space-y-3">
      <BooksFilters scope={scope} searchPlaceholder={`${t('detail')} / ${t('reference')}`}>
        <select value={kind ?? ''}
          onChange={(e) => scope.set({ kind: e.target.value || null, page: null })}
          className="h-9 rounded-lg border bg-card px-2 text-sm">
          <option value="">{t('allTypes')}</option>
          {(data?.kinds ?? []).map((k: any) => (
            <option key={k.kind} value={k.kind}>
              {docTypeLabel(k.kind, lang) || k.kind} ({formatId(k.documents)})
            </option>
          ))}
        </select>
      </BooksFilters>
      <BooksTable
        columns={columns} rows={data?.rows ?? []} total={data?.total ?? 0}
        scope={scope} loading={isLoading} error={error} onRetry={() => refetch()}
        getRowKey={(r) => `${r.ref1}-${r.order_num}`} emptyLabel={t('noRows')}
      />
    </div>
  )
}

export default function JournalPage() {
  return <Suspense fallback={<Skeleton className="h-96 w-full" />}><JournalInner /></Suspense>
}
