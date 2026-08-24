'use client'

/** מע״מ — the period as the return reads it: turnover, output, input, payable. */

import { Suspense } from 'react'
import { StatGrid, StatTile } from '@/components/shared/StatTile'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/feedback-state'
import { formatCurrency, formatCurrencyCompact, formatId } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useBooksVat } from '@/hooks/use-books'
import { useBooksScope } from '@/components/books/use-books-scope'
import { AccountLink, BooksFilters, useBooksText } from '@/components/books/BooksChrome'
import { VatChart } from '@/components/books/BooksCharts'

function VatInner() {
  useMoneyHidden()
  const scope = useBooksScope()
  const { t } = useBooksText()
  const { data, isLoading, error, refetch } = useBooksVat(scope.params as any)

  if (error) return <ErrorState onRetry={() => refetch()} className="mt-6" />
  const s = data?.summary

  return (
    <div className="space-y-3">
      <BooksFilters scope={scope} showDates searchPlaceholder={t('search')} />

      {isLoading ? <Skeleton className="h-24 w-full" /> : (
        <StatGrid columns={4}>
          <StatTile index={0} label={t('turnover')} value={formatCurrencyCompact(s?.turnover)} />
          <StatTile index={1} label={t('vatOut')} value={formatCurrencyCompact(s?.vat_out)} />
          <StatTile index={2} label={t('vatIn')} value={formatCurrencyCompact(s?.vat_in)} />
          <StatTile index={3} label={t('vatDue')} value={formatCurrencyCompact(s?.due)}
            higherIsBetter={false} tone="warn" />
        </StatGrid>
      )}

      {!isLoading && <VatChart months={data?.months ?? []} />}

      <section className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="pb-2 pe-4 text-start">{t('month')}</th>
                <th className="pb-2 pe-4 text-end">{t('movements')}</th>
                <th className="pb-2 pe-4 text-end">{t('turnover')}</th>
                <th className="pb-2 pe-4 text-end">{t('vatOut')}</th>
                <th className="pb-2 pe-4 text-end">{t('vatIn')}</th>
                <th className="pb-2 text-end">{t('vatDue')}</th>
              </tr>
            </thead>
            <tbody>
              {[...(data?.months ?? [])].reverse().map((m: any) => (
                <tr key={m.month} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="py-1.5 pe-4 font-mono text-xs">{m.month}</td>
                  <td className="py-1.5 pe-4 text-end tabular-nums">{formatId(m.movements)}</td>
                  <td className="py-1.5 pe-4 text-end tabular-nums">{formatCurrency(Number(m.turnover))}</td>
                  <td className="py-1.5 pe-4 text-end tabular-nums">{formatCurrency(Number(m.vat_out))}</td>
                  <td className="py-1.5 pe-4 text-end tabular-nums">{formatCurrency(Number(m.vat_in))}</td>
                  <td className="py-1.5 text-end font-semibold tabular-nums">{formatCurrency(Number(m.due))}</td>
                </tr>
              ))}
            </tbody>
            {s && (
              <tfoot>
                <tr className="border-t-2 bg-muted/40 font-semibold">
                  <td className="py-2 pe-4">{t('total')}</td>
                  <td />
                  <td className="py-2 pe-4 text-end tabular-nums">{formatCurrency(s.turnover)}</td>
                  <td className="py-2 pe-4 text-end tabular-nums">{formatCurrency(s.vat_out)}</td>
                  <td className="py-2 pe-4 text-end tabular-nums">{formatCurrency(s.vat_in)}</td>
                  <td className="py-2 text-end tabular-nums">{formatCurrency(s.due)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
        <h2 className="mb-2 text-sm font-semibold">{t('account')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="pb-2 pe-4 text-start">{t('account')}</th>
                <th className="pb-2 pe-4 text-start">{t('accountName')}</th>
                <th className="pb-2 pe-4 text-end">{t('movements')}</th>
                <th className="pb-2 pe-4 text-end">{t('debit')}</th>
                <th className="pb-2 text-end">{t('credit')}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.byAccount ?? []).map((r: any) => (
                <tr key={r.account} className="border-b last:border-0 hover:bg-muted/40">
                  <td className="py-1.5 pe-4">
                    <AccountLink code={r.account} year={scope.year} showName={false} />
                  </td>
                  <td className="py-1.5 pe-4" dir="auto">{r.name}</td>
                  <td className="py-1.5 pe-4 text-end tabular-nums">{formatId(r.movements)}</td>
                  <td className="py-1.5 pe-4 text-end tabular-nums">{formatCurrency(Number(r.debit))}</td>
                  <td className="py-1.5 text-end tabular-nums">{formatCurrency(Number(r.credit))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          מקור: קובץ תנועות המע״מ של ה-ERP. פקודות יומן ידניות שלא נרשמו בקובץ המע״מ
          אינן מופיעות כאן, אך כן מופיעות בכרטסת.
        </p>
      </section>
    </div>
  )
}

export default function VatPage() {
  return <Suspense fallback={<Skeleton className="h-96 w-full" />}><VatInner /></Suspense>
}
