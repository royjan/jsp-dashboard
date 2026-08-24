'use client'

/**
 * The furniture every bookkeeping screen shares: the tab strip, the year
 * picker, the filter bar, links out to the operational pages, and the pager.
 *
 * The tab strip is deliberately not `<SubTabs>`: these tabs must carry the
 * selected year, and a plain `href` drops the query string (and never matches
 * `usePathname()` when it contains one).
 */

import { useCallback } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLocale } from '@/lib/locale-context'
import { formatDate, formatId } from '@/lib/format'
import { BOOKS_STRINGS, ACCOUNT_CLASSES, DOC_TYPES, type BooksStringKey } from '@/lib/books/strings'
import type { BooksScopeState } from './use-books-scope'

/** Hebrew-first bookkeeping vocabulary; falls back to English by locale. */
export function useBooksText() {
  const { locale } = useLocale()
  const dict = locale === 'en' ? BOOKS_STRINGS.en : BOOKS_STRINGS.he
  const t = useCallback((key: BooksStringKey) => dict[key], [dict])
  const lang: 'he' | 'en' = locale === 'en' ? 'en' : 'he'
  return { t, lang, locale }
}

export const BOOKS_TABS = [
  { href: '/bookkeeping', key: 'overview' },
  { href: '/bookkeeping/accounts', key: 'accounts' },
  { href: '/bookkeeping/trial-balance', key: 'trialBalance' },
  { href: '/bookkeeping/journal', key: 'journal' },
  { href: '/bookkeeping/vat', key: 'vat' },
  { href: '/bookkeeping/cash', key: 'cash' },
  { href: '/bookkeeping/purchasing', key: 'purchasing' },
  { href: '/bookkeeping/years', key: 'years' },
] as const

export function BooksTabs() {
  const pathname = usePathname()
  const router = useRouter()
  const { t } = useBooksText()

  // Read the query string at click time, not at render: the URL helpers flush
  // on an animation frame, so a captured value can be one keystroke stale.
  const go = (href: string) => {
    const search = typeof window !== 'undefined' ? window.location.search : ''
    router.push(`${href}${search}`, { scroll: false })
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {BOOKS_TABS.map((tab) => {
        const active = tab.href === '/bookkeeping'
          ? pathname === tab.href
          : pathname.startsWith(tab.href)
        return (
          <button
            key={tab.href}
            type="button"
            onClick={() => go(tab.href)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              'pointer-coarse:min-h-11',
              active ? 'border-primary text-foreground'
                     : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(tab.key as BooksStringKey)}
          </button>
        )
      })}
    </div>
  )
}

export function YearPicker({ scope }: { scope: BooksScopeState }) {
  const { t } = useBooksText()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5">
        {scope.years.map((y) => (
          <button
            key={y.year}
            type="button"
            onClick={() => scope.setYear(y.year)}
            aria-pressed={y.year === scope.year}
            title={y.state === 'live' ? t('live') : t('closedYear')}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs tabular-nums transition-colors pointer-coarse:min-h-9',
              y.year === scope.year
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {formatId(y.year)}
          </button>
        ))}
      </div>
      {scope.isLive ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-400">
          <span className={cn('h-1.5 w-1.5 rounded-full bg-emerald-500',
            !scope.stale && 'animate-pulse')} />
          {t('live')}
        </span>
      ) : (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {t('closedYear')}
        </span>
      )}
    </div>
  )
}

/** Says so when the live year's loader has stopped, instead of letting old
 *  figures pass for current ones. */
export function StaleBanner({ scope }: { scope: BooksScopeState }) {
  const { t } = useBooksText()
  if (!scope.isLive || !scope.stale) return null
  const refreshed = scope.years.find((y) => y.year === scope.year)?.refreshed_at
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
      {t('staleWarning')}
      {refreshed && <span className="ms-1 opacity-80">· {t('refreshed')} {formatDate(refreshed, 'datetime')}</span>}
    </div>
  )
}

export function BooksFilters({ scope, searchPlaceholder, children, showDates = true }: {
  scope: BooksScopeState
  searchPlaceholder?: string
  children?: React.ReactNode
  showDates?: boolean
}) {
  const { t } = useBooksText()
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        defaultValue={scope.q}
        placeholder={searchPlaceholder ?? t('search')}
        onChange={(e) => {
          const value = e.target.value
          // Debounced by the URL helper's own batching; page resets so a
          // filtered list never opens on page 7 of the old one.
          window.clearTimeout((window as any).__booksSearchTimer)
          ;(window as any).__booksSearchTimer = window.setTimeout(
            () => scope.set({ q: value || null, page: null }), 350)
        }}
        className="h-9 min-w-[220px] rounded-lg border bg-card px-3 text-sm"
      />
      {children}
      {showDates && (
        <>
          <label className="text-xs text-muted-foreground">{t('from')}</label>
          <input type="date" value={scope.from} max={scope.to}
                 onChange={(e) => scope.set({ from: e.target.value, page: null })}
                 className="h-9 rounded-lg border bg-card px-2 text-sm" />
          <label className="text-xs text-muted-foreground">{t('to')}</label>
          <input type="date" value={scope.to} min={scope.from}
                 onChange={(e) => scope.set({ to: e.target.value, page: null })}
                 className="h-9 rounded-lg border bg-card px-2 text-sm" />
        </>
      )}
      <button type="button" onClick={scope.reset}
              className="h-9 rounded-lg border px-3 text-sm text-muted-foreground hover:text-foreground">
        {t('clear')}
      </button>
    </div>
  )
}

export function BooksPager({ scope, shown, total }: {
  scope: BooksScopeState; shown: number; total: number
}) {
  const { t } = useBooksText()
  const pageSize = 200
  if (total <= pageSize) {
    return <div className="py-2 text-center text-xs text-muted-foreground">
      {formatId(total)} {t('lines')}
    </div>
  }
  const pages = Math.ceil(total / pageSize)
  const first = (scope.page - 1) * pageSize + 1
  return (
    <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
      <button type="button" disabled={scope.page <= 1}
              onClick={() => scope.set({ page: scope.page - 1 })}
              className="rounded-lg border px-3 py-1 disabled:opacity-40">{t('prev')}</button>
      <span className="tabular-nums">
        {t('showing')} {formatId(first)}–{formatId(first + shown - 1)} {t('of')} {formatId(total)}
        {' · '}{formatId(scope.page)}/{formatId(pages)}
      </span>
      <button type="button" disabled={scope.page >= pages}
              onClick={() => scope.set({ page: scope.page + 1 })}
              className="rounded-lg border px-3 py-1 disabled:opacity-40">{t('next')}</button>
    </div>
  )
}

/* ── links out ─────────────────────────────────────────────────────────── */

const CUSTOMER_CLASSES = new Set(['2111', '2114', '2122'])
const SUPPLIER_CLASSES = new Set(['431', '432'])
const REF = /^([A-Z])(\d{2})(\d{4,7})$/

const pad10 = (code: string) => String(code ?? '').padStart(10, '0')

/** The dashboard page for an account — customers and suppliers have one;
 *  revenue, VAT and expense accounts do not, so they get no dead link. */
export function operationalHref(code: string, classCode?: string): string | null {
  if (!code || !code.replace(/^0+/, '')) return null
  if (SUPPLIER_CLASSES.has(classCode ?? '')) return `/suppliers/${pad10(code)}`
  if (CUSTOMER_CLASSES.has(classCode ?? '')) return `/customers/${pad10(code)}`
  return null
}

/** An account: its ledger card here, and its operational page where one exists. */
export function AccountLink({ code, name, classCode, year, showName = true }: {
  code: string; name?: string; classCode?: string; year: number; showName?: boolean
}) {
  const { t } = useBooksText()
  if (!code) return null
  const external = operationalHref(code, classCode)
  return (
    <span className="inline-flex items-center gap-1">
      <Link href={`/bookkeeping/accounts/${encodeURIComponent(code)}?year=${year}`}
            className="font-medium text-primary hover:underline" dir="auto">
        {code}{showName && name ? ` ${name}` : ''}
      </Link>
      {external && (
        <Link href={external} title={t('openInDashboard')}
              className="text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}>
          <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </span>
  )
}

/** A reference: the posting here, and the source document where the dashboard
 *  has one (`D11139330` → /documents/11/139330?year=2026). */
export function RefLink({ refCode, year }: { refCode: string; year: number }) {
  if (!refCode) return null
  const m = REF.exec(refCode.trim())
  const doc = m && m[1] === 'D'
    ? `/documents/${m[2]}/${m[3].replace(/^0+/, '') || '0'}?year=${year}`
    : null
  return (
    <span className="inline-flex items-center gap-1">
      <Link href={`/bookkeeping/journal/${encodeURIComponent(refCode)}?year=${year}`}
            className="font-mono text-xs text-primary hover:underline">
        {refCode}
      </Link>
      {doc && (
        <Link href={doc} className="text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}>
          <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </span>
  )
}

export function docTypeLabel(refCode: string, lang: 'he' | 'en'): string {
  return DOC_TYPES[(refCode ?? '').slice(0, 3)]?.[lang] ?? ''
}

export function accountClassLabel(classCode: string, lang: 'he' | 'en'): string {
  return ACCOUNT_CLASSES[classCode ?? '']?.[lang] ?? ''
}
