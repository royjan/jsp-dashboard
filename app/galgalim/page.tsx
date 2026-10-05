'use client'

import { useMemo, useState } from 'react'
import { Store, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import { useGalgalim, type GgRequest } from '@/lib/galgalim'

const FLOOR = 'https://halafim.galgalim.co.il/%D7%9E%D7%95%D7%9B%D7%A8/%D7%96%D7%99%D7%A8%D7%AA%D7%94%D7%9E%D7%A1%D7%97%D7%A8.aspx'
const OUTCOME: Record<GgRequest['outcome'], { he: string; cls: string }> = {
  offer: { he: 'להציע', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  not_stocked: { he: 'לא במלאי', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  not_found: { he: 'לא נמצא', cls: 'bg-muted text-muted-foreground' },
  error: { he: 'שגיאה', cls: 'bg-destructive/15 text-destructive' },
  backlog: { he: 'ישן', cls: 'bg-muted text-muted-foreground' },
}
const SOURCE: Record<string, string> = { 'כן': 'במלאי', 'לובינסקי': 'לובינסקי' }
const ago = (t: number | null) => (t ? `${Math.max(0, Math.round((Date.now() / 1000 - t) / 60))} דק׳` : '—')

/**
 * Galgalim trading-floor requests and what Diego v2 found for them (owner, 2026-10-05: "do we have this in the
 * dashboard as well so we can track? show the current week's messages in a table"). Read-only: the agent on .231
 * does the work and posts the staff cards to the DiegoV2 Telegram group; nothing here sends offers.
 */
export default function GalgalimPage() {
  const { locale } = useLocale()
  const he = locale === 'he'
  const [days, setDays] = useState(7)
  const [q, setQ] = useState('')
  const [only, setOnly] = useState<'' | GgRequest['outcome']>('')
  const { data, isLoading, error } = useGalgalim(days)
  const items = useMemo(() => (data?.items ?? []).filter((r) => r.outcome !== 'backlog')
    .filter((r) => !only || r.outcome === only)
    .filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase())), [data, q, only])
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const r of data?.items ?? []) if (r.outcome !== 'backlog') c[r.outcome] = (c[r.outcome] ?? 0) + 1
    return c
  }, [data])
  const st = data?.status

  return (
    <div className="space-y-4" dir={he ? 'rtl' : 'ltr'}>
      <PageHeader icon={Store} title="גלגלים" description="בקשות מזירת המסחר של גלגלים ומה דייגו v2 מצא — כרטיס לכל בקשה נשלח לקבוצת DiegoV2" />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(['offer', 'not_stocked', 'not_found', 'error'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setOnly(only === k ? '' : k)}
                  className={`rounded-md px-2.5 py-1 ${OUTCOME[k].cls} ${only === k ? 'ring-2 ring-primary' : ''}`}>
            {OUTCOME[k].he} · {counts[k] ?? 0}
          </button>
        ))}
        <select className="rounded-md border bg-background px-2 py-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 14, 30].map((d) => <option key={d} value={d}>{d} ימים אחרונים</option>)}
        </select>
        <Input className="w-56" placeholder="חיפוש (חלק, רכב, VIN…)" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="ms-auto text-xs text-muted-foreground">
          {st ? <>בדיקה אחרונה לפני {ago(st.last_ok)} · כל {Math.round(st.every_s / 60)} דק׳{st.last_error ? <span className="text-destructive"> · שגיאה: {st.last_error}</span> : null}</> : null}
        </span>
      </div>
      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {isLoading ? <Skeleton className="h-64" /> : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 text-start">מועד</th><th className="p-2 text-start">לקוח</th><th className="p-2 text-start">רכב</th>
                  <th className="p-2 text-start">חלק מבוקש</th><th className="p-2 text-start">דייגו v2</th>
                  <th className="p-2 text-start">הצעה מוצעת</th><th className="p-2 text-start">סטטוס</th><th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => {
                  const s = r.suggestion
                  const top = r.diego_rows?.[0]
                  return (
                    <tr key={r.id} className="border-t align-top">
                      <td className="whitespace-nowrap p-2 text-xs text-muted-foreground" dir="ltr">{r.date}</td>
                      <td className="p-2 text-xs">{r.ctype}<div className="text-muted-foreground">{r.location}</div></td>
                      <td className="p-2 text-xs">{r.make} {r.model} {r.year}
                        <div className="text-muted-foreground" dir="ltr">{r.vin || r.plate}</div></td>
                      <td className="p-2">{r.part}<div className="text-xs text-muted-foreground">{r.condition.join(' / ')}</div></td>
                      <td className="max-w-xs p-2 text-xs">
                        {top ? <>{top['תיאור']} · <span dir="ltr">{top['מק״ט']}</span>
                          <div className="text-muted-foreground">{(r.diego_rows?.length ?? 0)} שורות · {r.diego_s ?? '?'} ש׳</div></>
                          : <span className="text-muted-foreground">{r.error || r.diego_reply?.slice(0, 80) || '—'}</span>}
                      </td>
                      <td className="p-2 text-xs">
                        {s ? <><span dir="ltr">{s['מק״ט']}</span> · {s['מחיר']}<div className="text-muted-foreground">{SOURCE[s['במלאי'] ?? ''] ?? s['במלאי']}</div></> : '—'}
                      </td>
                      <td className="p-2">
                        <Badge variant="secondary" className={OUTCOME[r.outcome]?.cls}>{OUTCOME[r.outcome]?.he ?? r.outcome}</Badge>
                        {r.card_message_id ? <div className="mt-1 text-xs text-muted-foreground">כרטיס נשלח</div> : null}
                      </td>
                      <td className="p-2"><a href={FLOOR} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground" title="פתח בגלגלים"><ExternalLink className="h-4 w-4" /></a></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {data && !items.length && <p className="p-6 text-center text-sm text-muted-foreground">אין בקשות בטווח הזה</p>}
        </CardContent>
      </Card>
    </div>
  )
}
