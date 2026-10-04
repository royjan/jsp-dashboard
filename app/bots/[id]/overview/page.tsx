'use client'

import { use } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ChartGrid, AXIS_PROPS } from '@/components/charts/kit'
import { seriesColor } from '@/lib/chart-colors'
import { useLocale } from '@/lib/locale-context'
import { formatNumber } from '@/lib/constants'
import { useBotStats } from '@/lib/bots-admin'
import { Kpi, ListCard, CHANNEL_HE, REFUSAL_HE } from '../_parts'

/** /bots/<id>/overview?days=7|30|90 */
export default function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { locale } = useLocale()
  const he = locale === 'he'
  const tr = (h: string, e: string) => (he ? h : e)
  const sp = useSearchParams()
  const router = useRouter()
  const days = [7, 30, 90].includes(Number(sp.get('days'))) ? Number(sp.get('days')) : 30
  const setDays = (d: number) => router.replace(`/bots/${id}/overview${d === 30 ? '' : `?days=${d}`}`, { scroll: false })
  const stats = useBotStats(id, days)

  return (
    <div className="space-y-4">
    <div className="flex gap-2">
      {[7, 30, 90].map((d) => (
        <Button key={d} size="sm" variant={d === days ? 'default' : 'outline'} onClick={() => setDays(d)}>
          {d} {tr('ימים', 'days')}
        </Button>
      ))}
    </div>
    {stats.isLoading && <Skeleton className="h-72" />}
    {stats.data && (() => {
      const s = stats.data
      const refused = Object.values(s.refused).reduce((a, n) => a + n, 0)
      return (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label={tr('שאלות', 'Questions')} value={formatNumber(s.questions)} />
            <Kpi label={tr('נענו', 'Answered')} value={s.questions ? `${Math.round((100 * s.ok) / s.questions)}%` : '—'} />
            <Kpi label={tr('שגיאות', 'Errors')} value={formatNumber(s.errors)} />
            <Kpi label={tr('נחסמו', 'Refused')} value={formatNumber(refused)} />
            <Kpi label={tr('משתמשים', 'Users')} value={formatNumber(s.unique_users)} />
            <Kpi label={tr('זמן תשובה (חציון / 90%)', 'Answer time (median / p90)')}
                 value={`${s.latency_s.median ?? '—'}s / ${s.latency_s.p90 ?? '—'}s`} />
          </div>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{tr('שאלות ביום', 'Questions per day')}</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.per_day}>
                  <ChartGrid />
                  <XAxis dataKey="day" {...AXIS_PROPS} tickFormatter={(d: string) => d.slice(5)} />
                  <YAxis {...AXIS_PROPS} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="ok" stackId="a" name={tr('נענו', 'Answered')} fill={seriesColor(0)} />
                  <Bar dataKey="errors" stackId="a" name={tr('שגיאות', 'Errors')} fill={seriesColor(3)} />
                  <Bar dataKey="refused" stackId="a" name={tr('נחסמו', 'Refused')} fill={seriesColor(5)} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <div className="grid gap-4 md:grid-cols-3">
            <ListCard title={tr('ערוצים', 'Channels')}
                      rows={Object.entries(s.channels).map(([k, n]) => [he ? CHANNEL_HE[k] ?? k : k, n])} />
            <ListCard title={tr('סיבות חסימה', 'Refusals')}
                      rows={Object.entries(s.refused).map(([k, n]) => [he ? REFUSAL_HE[k] ?? k : k, n])}
                      empty={tr('אין', 'None')} />
            <ListCard title={tr('מילים נפוצות בשאלות', 'Common words')} rows={s.top_words.slice(0, 10)} />
          </div>
        </>
      )
    })()}
    </div>
  )
}
