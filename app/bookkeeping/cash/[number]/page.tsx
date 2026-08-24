'use client'

/** One receipt: its tenders, and how it landed in the books. */

import { Suspense, use } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { StatGrid, StatTile } from '@/components/shared/StatTile'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/ui/feedback-state'
import { formatCurrency, formatCurrencyCompact, formatDate, formatId } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useBooksReceipt } from '@/hooks/use-books'
import { useBooksScope } from '@/components/books/use-books-scope'
import { AccountLink, useBooksText } from '@/components/books/BooksChrome'
import { PAY_TYPES } from '@/lib/books/strings'

function ReceiptInner({ number }: { number: string }) {
  useMoneyHidden()
  const scope = useBooksScope()
  const { t, lang } = useBooksText()
  const { data, isLoading, error, refetch } = useBooksReceipt(number, scope.year)

  if (error) return <ErrorState onRetry={() => refetch()} className="mt-6" />
  if (isLoading) return <Skeleton className="h-72 w-full" />
  if (!data?.receipt) return <EmptyState title={t('noRows')} description={t('noRowsHint')} />

  const r = data.receipt
  const linesTotal = (data.lines ?? []).reduce((s: number, l: any) => s + Number(l.amount ?? 0), 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/bookkeeping/cash?year=${scope.year}`} className="hover:text-foreground">
          {t('cash')}
        </Link>
        <ArrowRight className="h-3 w-3 rotate-180" />
        <span className="font-mono text-foreground">{r.number}</span>
        <span dir="auto" className="text-foreground">{r.name}</span>
      </div>

      <StatGrid columns={4}>
        <StatTile index={0} label={t('amount')} value={formatCurrencyCompact(r.amount)} />
        <StatTile index={1} label={t('date')} value={formatDate(r.date)} />
        <StatTile index={2} label={t('time')} value={r.time || '—'} />
        <StatTile index={3} label={t('lines')} value={formatId(data.lines?.length ?? 0)} />
      </StatGrid>

      <section className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <b dir="auto">{r.name}</b>
          <AccountLink code={r.account} year={scope.year} showName={false} />
          <span className="text-muted-foreground">{r.city}</span>
          <span className="font-mono text-xs text-muted-foreground">{r.phone}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="pb-2 pe-4 text-start">#</th>
                <th className="pb-2 pe-4 text-start">{t('tender')}</th>
                <th className="pb-2 pe-4 text-start">{t('bank')}</th>
                <th className="pb-2 pe-4 text-start">{t('branch')}</th>
                <th className="pb-2 pe-4 text-start">{t('reference')}</th>
                <th className="pb-2 pe-4 text-start">{t('dueDate')}</th>
                <th className="pb-2 pe-4 text-start">{t('depositAccount')}</th>
                <th className="pb-2 text-end">{t('amount')}</th>
              </tr>
            </thead>
            <tbody>
              {(data.lines ?? []).map((l: any) => (
                <tr key={l.line} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="py-1.5 pe-4 text-xs text-muted-foreground">{l.line}</td>
                  <td className="py-1.5 pe-4">{PAY_TYPES[l.pay_type]?.[lang] ?? l.pay_type}</td>
                  <td className="py-1.5 pe-4 font-mono text-xs">{l.bank}</td>
                  <td className="py-1.5 pe-4 font-mono text-xs">{l.branch}</td>
                  <td className="py-1.5 pe-4 font-mono text-xs">{l.reference}</td>
                  <td className="py-1.5 pe-4">{formatDate(l.due_date)}</td>
                  <td className="py-1.5 pe-4">
                    <AccountLink code={l.deposit_account} year={scope.year} showName={false} />
                  </td>
                  <td className="py-1.5 text-end tabular-nums">{formatCurrency(Number(l.amount))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 bg-muted/40 font-semibold">
                <td className="py-2 pe-4" colSpan={7}>{t('total')}</td>
                <td className="py-2 text-end tabular-nums">{formatCurrency(linesTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {(data.posted ?? []).length > 0 && (
        <section className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
          <h2 className="mb-2 text-sm font-semibold">{t('postedToBooks')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="pb-2 pe-4 text-start">{t('account')}</th>
                  <th className="pb-2 pe-4 text-start">{t('accountName')}</th>
                  <th className="pb-2 pe-4 text-start">{t('date')}</th>
                  <th className="pb-2 pe-4 text-start">{t('detail')}</th>
                  <th className="pb-2 pe-4 text-end">{t('debit')}</th>
                  <th className="pb-2 text-end">{t('credit')}</th>
                </tr>
              </thead>
              <tbody>
                {data.posted.map((p: any, i: number) => (
                  <tr key={p.fp ?? i} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-1.5 pe-4">
                      <AccountLink code={p.account} year={scope.year} showName={false} />
                    </td>
                    <td className="py-1.5 pe-4" dir="auto">{p.account_name}</td>
                    <td className="py-1.5 pe-4">{formatDate(p.doc_date)}</td>
                    <td className="py-1.5 pe-4" dir="auto">{p.detail}</td>
                    <td className="py-1.5 pe-4 text-end tabular-nums">{formatCurrency(Number(p.debit))}</td>
                    <td className="py-1.5 text-end tabular-nums">{formatCurrency(Number(p.credit))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

export default function ReceiptPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = use(params)
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ReceiptInner number={decodeURIComponent(number)} />
    </Suspense>
  )
}
