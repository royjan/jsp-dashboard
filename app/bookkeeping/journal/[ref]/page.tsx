'use client'

/** One reference: the postings behind it, and its VAT movements. */

import { Suspense, use } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { StatGrid, StatTile } from '@/components/shared/StatTile'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState, EmptyState } from '@/components/ui/feedback-state'
import { formatCurrency, formatCurrencyCompact, formatDate, formatId } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useJournalEntry } from '@/hooks/use-books'
import { useBooksScope } from '@/components/books/use-books-scope'
import { AccountLink, docTypeLabel, useBooksText } from '@/components/books/BooksChrome'

function LineTable({ rows, year, title }: { rows: any[]; year: number; title?: string }) {
  const { t } = useBooksText()
  if (!rows.length) return null
  return (
    <section className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
      {title && <h2 className="mb-2 text-sm font-semibold">{title}</h2>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="pb-2 pe-4 text-start">#</th>
              <th className="pb-2 pe-4 text-start">{t('account')}</th>
              <th className="pb-2 pe-4 text-start">{t('counterAccount')}</th>
              <th className="pb-2 pe-4 text-start">{t('detail')}</th>
              <th className="pb-2 pe-4 text-end">{t('debit')}</th>
              <th className="pb-2 text-end">{t('credit')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.fp ?? i}`} className="border-b last:border-0 hover:bg-muted/40">
                <td className="py-1.5 pe-4 text-xs text-muted-foreground">{r.order_line || i + 1}</td>
                <td className="py-1.5 pe-4">
                  <AccountLink code={r.account} name={r.account_name}
                    classCode={r.class_code} year={year} />
                </td>
                <td className="py-1.5 pe-4">
                  <AccountLink code={r.counter_account} name={r.counter_name}
                    classCode={r.counter_class} year={year} />
                </td>
                <td className="py-1.5 pe-4" dir="auto">{r.detail}</td>
                <td className="py-1.5 pe-4 text-end tabular-nums">{formatCurrency(Number(r.debit))}</td>
                <td className="py-1.5 text-end tabular-nums">{formatCurrency(Number(r.credit))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function EntryInner({ refCode }: { refCode: string }) {
  useMoneyHidden()
  const scope = useBooksScope()
  const { t, lang } = useBooksText()
  const { data, isLoading, error, refetch } = useJournalEntry(refCode, scope.year)

  if (error) return <ErrorState onRetry={() => refetch()} className="mt-6" />
  if (isLoading) return <Skeleton className="h-72 w-full" />
  if (!data?.lines?.length) {
    return <EmptyState title={t('noRows')} description={t('noRowsHint')} />
  }

  const s = data.summary
  const m = /^([A-Z])(\d{2})(\d{4,7})$/.exec(refCode)
  const documentHref = m && m[1] === 'D'
    ? `/documents/${m[2]}/${m[3].replace(/^0+/, '') || '0'}?year=${scope.year}` : null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/bookkeeping/journal?year=${scope.year}`}
              className="hover:text-foreground">{t('journal')}</Link>
        <ArrowRight className="h-3 w-3 rotate-180" />
        <span className="font-mono text-foreground">{refCode}</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
          {docTypeLabel(refCode, lang)}
        </span>
        {documentHref && (
          <Link href={documentHref}
                className="ms-auto rounded-lg border px-3 py-1.5 text-sm text-primary hover:bg-accent">
            {t('openInDashboard')} ↗
          </Link>
        )}
      </div>

      <StatGrid columns={4}>
        <StatTile index={0} label={t('lines')} value={formatId(s.lines)} />
        <StatTile index={1} label={t('debit')} value={formatCurrencyCompact(s.debit)} />
        <StatTile index={2} label={t('credit')} value={formatCurrencyCompact(s.credit)} />
        <StatTile index={3} label={t('balanced')}
          value={s.balanced ? '✓' : formatCurrency(s.debit - s.credit)}
          tone={s.balanced ? 'good' : 'bad'} />
      </StatGrid>

      <LineTable rows={data.lines} year={scope.year} />
      <LineTable rows={data.vat} year={scope.year} title={t('vatMovements')} />
      <p className="text-xs text-muted-foreground">
        {formatDate(data.lines[0]?.doc_date)}
      </p>
    </div>
  )
}

export default function JournalEntryPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = use(params)
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <EntryInner refCode={decodeURIComponent(ref)} />
    </Suspense>
  )
}
