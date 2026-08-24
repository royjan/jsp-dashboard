'use client'

/** שנים — every fiscal year the books hold, and how each one closed. */

import { Suspense } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/feedback-state'
import { formatCurrency, formatDate, formatId } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useBooksYears } from '@/hooks/use-books'
import { useBooksScope } from '@/components/books/use-books-scope'
import { useBooksText } from '@/components/books/BooksChrome'
import { YearsChart } from '@/components/books/BooksCharts'

function YearsInner() {
  useMoneyHidden()
  const scope = useBooksScope()
  const { t } = useBooksText()
  const { data, isLoading, error, refetch } = useBooksYears(true)

  if (error) return <ErrorState onRetry={() => refetch()} className="mt-6" />
  if (isLoading) return <Skeleton className="h-96 w-full" />

  const meta = new Map<number, any>((data?.years ?? []).map((y: any) => [y.year, y]))
  const totals = [...(data?.totals ?? [])].map((r: any) => ({ ...r, year: Number(r.year) }))

  return (
    <div className="space-y-3">
      <YearsChart totals={totals} />
      <section className="rounded-xl border bg-card p-3 shadow-sm sm:p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="pb-2 pe-4 text-start">{t('year')}</th>
                <th className="pb-2 pe-4 text-start">{t('live')}</th>
                <th className="pb-2 pe-4 text-end">{t('movements')}</th>
                <th className="pb-2 pe-4 text-end">{t('sales')}</th>
                <th className="pb-2 pe-4 text-end">{t('receipts')}</th>
                <th className="pb-2 pe-4 text-end">{t('debit')}</th>
                <th className="pb-2 pe-4 text-end">{t('credit')}</th>
                <th className="pb-2 pe-4 text-center">{t('balanced')}</th>
                <th className="pb-2 text-start">{t('refreshed')}</th>
              </tr>
            </thead>
            <tbody>
              {[...totals].reverse().map((r) => {
                const info = meta.get(r.year)
                const diff = Number(r.debit ?? 0) - Number(r.credit ?? 0)
                return (
                  <tr key={r.year} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="py-1.5 pe-4">
                      <button type="button" onClick={() => scope.setYear(r.year)}
                        className="font-mono text-primary hover:underline">{formatId(r.year)}</button>
                    </td>
                    <td className="py-1.5 pe-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        info?.state === 'live'
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground'}`}>
                        {info?.state === 'live' ? t('live') : t('closedYear')}
                      </span>
                    </td>
                    <td className="py-1.5 pe-4 text-end tabular-nums">{formatId(r.movements)}</td>
                    <td className="py-1.5 pe-4 text-end tabular-nums">{formatCurrency(Number(r.sales))}</td>
                    <td className="py-1.5 pe-4 text-end tabular-nums">{formatCurrency(Number(r.receipts))}</td>
                    <td className="py-1.5 pe-4 text-end tabular-nums">{formatCurrency(Number(r.debit))}</td>
                    <td className="py-1.5 pe-4 text-end tabular-nums">{formatCurrency(Number(r.credit))}</td>
                    <td className="py-1.5 pe-4 text-center">
                      {Math.abs(diff) < 0.01
                        ? <span className="text-emerald-600 dark:text-emerald-400">✓</span>
                        : <span className="text-red-600 dark:text-red-400">{formatCurrency(diff)}</span>}
                    </td>
                    <td className="py-1.5 text-xs text-muted-foreground">
                      {info?.refreshed_at ? formatDate(info.refreshed_at, 'datetime') : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
      <p className="text-xs text-muted-foreground">
        שנים סגורות נטענות פעם אחת ואינן משתנות; השנה הפעילה נקראת מה-ERP ומתעדכנת שוב ושוב.
      </p>
    </div>
  )
}

export default function YearsPage() {
  return <Suspense fallback={<Skeleton className="h-96 w-full" />}><YearsInner /></Suspense>
}
