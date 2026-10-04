'use client'

import Link from 'next/link'
import { Bot, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import { useBots, type BotOverview } from '@/lib/bots-admin'
import { formatNumber } from '@/lib/constants'

const STATUS: Record<BotOverview['status'], { he: string; en: string; cls: string }> = {
  up: { he: 'פעיל', en: 'Up', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  partial: { he: 'חלקי', en: 'Partial', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  down: { he: 'כבוי', en: 'Down', cls: 'bg-muted text-muted-foreground' },
}

export default function BotsPage() {
  const { locale } = useLocale()
  const he = locale === 'he'
  const { data, isLoading, error } = useBots()

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Bot}
        title={he ? 'בוטים' : 'Bots'}
        description={he ? 'שימוש, ביצועים והגבלות לכל בוט' : 'Usage, performance and limits per bot'}
      />
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-44" />)}
        {data?.map((b) => {
          const s = STATUS[b.status]
          const okPct = b.week.questions ? Math.round((100 * b.week.ok) / b.week.questions) : null
          return (
            <Link key={b.id} href={`/bots/${b.id}`} className="block">
              <Card className="h-full transition-colors hover:border-primary">
                <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{b.name}</CardTitle>
                    {b.description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{b.description}</p>}
                  </div>
                  <Badge className={s.cls}>{he ? s.he : s.en}</Badge>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <Stat label={he ? 'היום' : 'Today'} value={formatNumber(b.today.questions)} />
                    <Stat label={he ? '7 ימים' : '7 days'} value={formatNumber(b.week.questions)} />
                    <Stat label={he ? 'הצלחה' : 'Success'} value={okPct === null ? '—' : `${okPct}%`} />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{he ? 'חציון' : 'Median'} {b.week.median_s ?? '—'}s</span>
                    {b.memory_mb ? <span>{formatNumber(b.memory_mb)} MB</span> : null}
                    {b.brands.CATALOG_ONLY_BRANDS && <span dir="ltr">{b.brands.CATALOG_ONLY_BRANDS}</span>}
                    {b.policy.daily_limit_per_user ? (
                      <span>{he ? `עד ${b.policy.daily_limit_per_user} ליום` : `${b.policy.daily_limit_per_user}/day`}</span>
                    ) : null}
                    {b.policy.allow_list?.length ? <span>{he ? 'רשימה סגורה' : 'Allow-list'}</span> : null}
                    {b.policy.show_prices === false && <span>{he ? 'ללא מחירים' : 'No prices'}</span>}
                    {b.web_url && (
                      <a href={b.web_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                         className="inline-flex items-center gap-1 hover:text-primary">
                        <ExternalLink className="h-3 w-3" />{he ? 'קונסולה' : 'Console'}
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 py-2">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}
