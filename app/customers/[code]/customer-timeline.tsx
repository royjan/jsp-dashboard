'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { useCustomerTimeline } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import type { TranslationKey } from '@/lib/i18n'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatCurrency, formatDate } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import {
  TIMELINE_FILTERS, countByKind, dayKey, filterTimeline, groupByDay,
  type TimelineEvent, type TimelineFilter, type TimelineKind, type TimelineSource,
} from '@/lib/customer-timeline'

/**
 * "ציר זמן" — everything that happened with this customer, newest first,
 * grouped by day. Data and source rules live in
 * `app/api/customers/[code]/timeline/route.ts`; the merge/sort/group logic in
 * `lib/customer-timeline.ts`.
 */

// Dot colour per kind — semantic/chart tokens, so dark mode follows the theme.
const KIND_DOT: Record<TimelineKind, string> = {
  request: 'bg-chart-1',
  quote: 'bg-chart-7',
  invoice: 'bg-chart-3',
  delivery: 'bg-chart-2',
  payment: 'bg-success',
  held: 'bg-chart-4',
}

const PAGE = 120

const IL_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
})

function fill(s: string, vars: Record<string, string | undefined>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}

export function CustomerTimeline({ code, enabled }: { code: string; enabled: boolean }) {
  // formatCurrency() masks from a module store; subscribe so the eye toggle re-renders.
  useMoneyHidden()
  const { t, locale, dir } = useLocale()
  const tk = (k: string) => t(k as TranslationKey)
  const { data, isLoading, error } = useCustomerTimeline(code, enabled)
  const [filter, setFilter] = useState<TimelineFilter>('all')
  const [limit, setLimit] = useState(PAGE)
  // Fixed at mount: "today" for a page left open overnight is a reload away.
  const [{ today, yesterday }] = useState(() => ({
    today: dayKey(new Date().toISOString()),
    yesterday: dayKey(new Date(Date.now() - 86_400_000).toISOString()),
  }))

  const events = useMemo(() => data?.events ?? [], [data])
  const counts = useMemo(() => countByKind(events), [events])
  const filtered = useMemo(() => filterTimeline(events, filter), [events, filter])
  const days = useMemo(() => groupByDay(filtered.slice(0, limit)), [filtered, limit])

  const failed = data
    ? (Object.entries(data.sources) as [TimelineSource, { ok: boolean }][]).filter(([, s]) => !s.ok).map(([k]) => k)
    : []

  if (!enabled || isLoading) {
    return (
      <div className="space-y-3 py-2" aria-busy="true">
        {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    )
  }
  if (error || !data) {
    return <p role="alert" className="py-6 text-center text-sm text-destructive">{tk('timeline.loadFailed')}</p>
  }

  const dayLabel = (day: string) => {
    if (day === today) return tk('timeline.today')
    if (day === yesterday) return tk('timeline.yesterday')
    const d = new Date(`${day}T12:00:00`)
    const weekday = d.toLocaleDateString(locale === 'he' ? 'he-IL' : 'en-GB', { weekday: 'long' })
    return `${weekday} · ${formatDate(day)}`
  }

  // Radix Tabs stamps dir="ltr" on its content unless told otherwise, so the
  // direction is set here explicitly or the whole tab renders mirrored.
  return (
    <div dir={dir} className="space-y-4">
      {/* Filter row */}
      <div role="group" aria-label={tk('timeline.filterLabel')} className="flex flex-wrap gap-1.5">
        {TIMELINE_FILTERS.map((f) => {
          const active = f === filter
          return (
            <button
              key={f}
              type="button"
              aria-pressed={active}
              onClick={() => { setFilter(f); setLimit(PAGE) }}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-background text-foreground hover:bg-accent',
              )}
            >
              {f !== 'all' && <span aria-hidden className={cn('h-2 w-2 rounded-full', KIND_DOT[f])} />}
              {tk(`timeline.filter.${f}`)}
              <span className={cn('tabular-nums', active ? 'opacity-90' : 'text-muted-foreground')}>{counts[f]}</span>
            </button>
          )
        })}
      </div>

      {/* Per-source failure: the rest still renders, and the gap is named. */}
      {failed.length > 0 && (
        <div role="status" className="space-y-1">
          {failed.map((s) => (
            <p key={s} className="flex items-center gap-1.5 text-xs text-warning-subtle-foreground">
              <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
              {fill(tk('timeline.unavailable'), { x: tk(`timeline.source.${s}`) })}
            </p>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        {tk('timeline.window')}
        {data.finapiSince && (
          <>
            <br />
            {fill(tk('timeline.docsSince'), { date: formatDate(data.finapiSince) })}
          </>
        )}
      </p>

      {days.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {filter === 'all' ? tk('timeline.empty') : tk('timeline.emptyFiltered')}
        </p>
      ) : (
        <div className="space-y-5">
          {days.map((g) => (
            <section key={g.day} aria-labelledby={`tl-day-${g.day}`}>
              <h3 id={`tl-day-${g.day}`} className="sticky top-0 z-[1] mb-2 bg-card py-1 text-xs font-semibold text-muted-foreground">
                {dayLabel(g.day)}
              </h3>
              <ol className="relative space-y-0.5 border-s border-border ms-[3.25rem]">
                {g.events.map((e) => <EventRow key={e.id} e={e} tk={tk} />)}
              </ol>
            </section>
          ))}
          {filtered.length > limit && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => setLimit((n) => n + PAGE)}
                className="rounded-lg border px-3 py-1.5 text-sm text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {locale === 'he' ? `הצג עוד (${filtered.length - limit})` : `Show more (${filtered.length - limit})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function describe(e: TimelineEvent, tk: (k: string) => string): { title: string; detail: string[] } {
  const plate = e.plate ? fill(tk('timeline.plate'), { p: e.plate }) : undefined
  const parts = (...xs: (string | undefined | false)[]) => xs.filter((x): x is string => !!x)
  switch (e.kind) {
    case 'request': {
      if (e.subtype === 'lookup') {
        const st = e.status === 'miss' ? tk('timeline.request.miss')
          : e.status === 'partial' ? tk('timeline.request.partial') : undefined
        return { title: tk('timeline.request.lookup'), detail: parts(plate, e.text, st, e.who) }
      }
      if (e.subtype === 'session') {
        return { title: tk('timeline.request.session'), detail: parts(plate, e.text, e.who) }
      }
      return {
        title: e.who ? `${tk('timeline.request.message')} · ${e.who}` : tk('timeline.request.message'),
        detail: parts(plate, e.text),
      }
    }
    case 'quote':
      return { title: fill(tk('timeline.quote'), { n: e.number }), detail: [] }
    case 'invoice': {
      const known = ['11', '12', '21'].includes(e.subtype ?? '')
      return {
        title: known
          ? fill(tk(`timeline.doc.${e.subtype}`), { n: e.number })
          : fill(tk('timeline.doc.other'), { n: e.number, f: e.subtype }),
        detail: [],
      }
    }
    case 'payment':
      return { title: parts(tk('timeline.payment'), e.number).join(' '), detail: parts(e.text) }
    case 'delivery': {
      const key = ['assigned', 'in_transit', 'delivered', 'failed'].includes(e.subtype ?? '') ? e.subtype : 'assigned'
      return {
        title: tk(`timeline.delivery.${key}`),
        detail: parts(e.who, e.number && fill(tk('timeline.delivery.doc'), { n: e.number }), e.text),
      }
    }
    case 'held': {
      const head = e.subtype === 'arrived' ? tk('timeline.held.arrived') : tk('timeline.held.ordered')
      return {
        title: e.who ? `${head} ${fill(tk('timeline.held.from'), { s: e.who })}` : head,
        detail: parts(
          e.text,
          e.number && fill(tk('timeline.held.order'), { n: e.number }),
          e.subtype !== 'arrived' && e.status ? tk(`timeline.held.status.${e.status}`) : undefined,
        ),
      }
    }
  }
}

function EventRow({ e, tk }: { e: TimelineEvent; tk: (k: string) => string }) {
  const { title, detail } = describe(e, tk)
  const time = e.hasTime ? IL_TIME.format(new Date(e.at)) : ''

  const titleNode = e.href ? (
    e.external ? (
      <a
        href={e.href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      >
        {title}
        <ExternalLink aria-hidden className="h-3 w-3" />
        <span className="sr-only">({tk('timeline.opensChat')})</span>
      </a>
    ) : (
      <Link
        href={e.href}
        className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
      >
        {title}
      </Link>
    )
  ) : (
    <span>{title}</span>
  )

  return (
    <li className="relative flex items-start gap-3 py-1.5 ps-4">
      {/* Clock time sits outside the rail, on the start side. */}
      <span className="absolute -start-[3.25rem] top-1.5 w-10 text-end text-xs tabular-nums text-muted-foreground">
        {time}
      </span>
      <span
        aria-hidden
        className={cn('absolute -start-[5px] top-[0.6rem] h-2.5 w-2.5 rounded-full ring-2 ring-card', KIND_DOT[e.kind])}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium"><bdi>{titleNode}</bdi></div>
        {detail.length > 0 && (
          <p className="truncate text-xs text-muted-foreground" title={detail.join(' · ')}>
            {/* bdi: customer text can be English or Hebrew; isolate it without moving the line's alignment. */}
            <bdi>{detail.join(' · ')}</bdi>
          </p>
        )}
      </div>
      {e.amount !== undefined && (
        <span className="shrink-0 text-sm font-medium tabular-nums">{formatCurrency(e.amount)}</span>
      )}
    </li>
  )
}
