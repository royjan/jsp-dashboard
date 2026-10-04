'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { Bot, ArrowRight, Play, Square, RotateCw, ExternalLink } from 'lucide-react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ChartGrid, AXIS_PROPS } from '@/components/charts/kit'
import { seriesColor } from '@/lib/chart-colors'
import { useLocale } from '@/lib/locale-context'
import { formatNumber } from '@/lib/constants'
import {
  useBot, useBotStats, useBotTurns, useSaveBotPolicy, useSaveBotBrands, useBotAction, useSaveBotTelegram,
  type BotPolicy, type BotBrands, type BotTelegram,
} from '@/lib/bots-admin'

const CHANNEL_HE: Record<string, string> = { ui: 'קונסולה', telegram: 'טלגרם', whatsapp: 'וואטסאפ' }
const REFUSAL_HE: Record<string, string> = { over_limit: 'מעל המכסה', not_allowed: 'לא מורשה' }

export default function BotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { locale } = useLocale()
  const he = locale === 'he'
  const tr = (h: string, e: string) => (he ? h : e)
  const [days, setDays] = useState(30)
  const bot = useBot(id)
  const stats = useBotStats(id, days)
  const turns = useBotTurns(id)
  const action = useBotAction(id)
  const b = bot.data

  return (
    <div className="space-y-6">
      <Link href="/bots" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowRight className="h-4 w-4 ltr:rotate-180" />{tr('כל הבוטים', 'All bots')}
      </Link>
      <PageHeader
        icon={Bot}
        title={b?.name ?? id}
        description={b ? `${b.status === 'up' ? tr('פעיל', 'Up') : b.status === 'down' ? tr('כבוי', 'Down') : tr('חלקי', 'Partial')}${b.memory_mb ? ` · ${formatNumber(b.memory_mb)} MB` : ''}` : undefined}
        actions={b && (
          <div className="flex flex-wrap gap-2">
            {b.web_url && (
              <Button asChild variant="outline" size="sm">
                <a href={b.web_url} target="_blank" rel="noreferrer"><ExternalLink className="me-1 h-4 w-4" />{tr('קונסולה', 'Console')}</a>
              </Button>
            )}
            {b.status !== 'up' && (
              <Button size="sm" disabled={action.isPending} onClick={() => action.mutate('start')}>
                <Play className="me-1 h-4 w-4" />{tr('הפעל', 'Start')}
              </Button>
            )}
            {b.status !== 'down' && (
              <>
                <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => action.mutate('restart')}>
                  <RotateCw className="me-1 h-4 w-4" />{tr('הפעל מחדש', 'Restart')}
                </Button>
                <Button size="sm" variant="outline" disabled={action.isPending}
                        onClick={() => window.confirm(tr('לכבות את הבוט?', 'Stop this bot?')) && action.mutate('stop')}>
                  <Square className="me-1 h-4 w-4" />{tr('כבה', 'Stop')}
                </Button>
              </>
            )}
          </div>
        )}
      />
      {action.isPending && <p className="text-sm text-muted-foreground">{tr('מבצע… (עד דקה)', 'Working… (up to a minute)')}</p>}
      {action.error && <p className="text-sm text-destructive">{(action.error as Error).message}</p>}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{tr('סקירה', 'Overview')}</TabsTrigger>
          <TabsTrigger value="turns">{tr('שיחות', 'Conversations')}</TabsTrigger>
          <TabsTrigger value="settings">{tr('הגדרות והגבלות', 'Settings & limits')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
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
        </TabsContent>

        <TabsContent value="turns">
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2 text-start">{tr('זמן', 'Time')}</th>
                    <th className="p-2 text-start">{tr('ערוץ / שולח', 'Channel / sender')}</th>
                    <th className="p-2 text-start">{tr('שאלה', 'Question')}</th>
                    <th className="p-2 text-start">{tr('תשובה (שורה ראשונה)', 'Answer (first line)')}</th>
                    <th className="p-2 text-start">{tr('שניות', 'Secs')}</th>
                  </tr>
                </thead>
                <tbody>
                  {turns.data?.map((t, i) => (
                    <tr key={i} className="border-t align-top">
                      <td className="whitespace-nowrap p-2 text-xs text-muted-foreground" dir="ltr">
                        {new Date(t.ts * 1000).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-2 text-xs">
                        {he ? CHANNEL_HE[t.channel] ?? t.channel : t.channel}
                        {t.sender && <div className="text-muted-foreground" dir="ltr">{t.sender}</div>}
                      </td>
                      <td className="max-w-xs p-2">{t.question}</td>
                      <td className="max-w-md p-2 text-xs text-muted-foreground">
                        {!t.ok && <Badge variant="destructive" className="me-1">{tr('שגיאה', 'Error')}</Badge>}{t.answer || t.error}
                      </td>
                      <td className="p-2 tabular-nums">{t.elapsed_s ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {turns.data?.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{tr('אין שיחות עדיין', 'No conversations yet')}</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          {b && <TelegramCard key={`${b.policy.telegram_auth}|${b.policy.access_code}|${(b.policy.telegram_groups ?? []).join(',')}`} id={id} tg={b.telegram} policy={b.policy} he={he} />}
          {b && <PolicyForm key={JSON.stringify(b.policy)} id={id} policy={b.policy} he={he} />}
          {b && <BrandsForm key={JSON.stringify(b.brands)} id={id} brands={b.brands} he={he} />}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

function ListCard({ title, rows, empty }: { title: string; rows: [string, number][]; empty?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-1 text-sm">
        {rows.length === 0 && <p className="text-muted-foreground">{empty ?? '—'}</p>}
        {rows.map(([k, n]) => (
          <div key={k} className="flex justify-between gap-2"><span className="truncate">{k}</span><span className="tabular-nums text-muted-foreground">{formatNumber(n)}</span></div>
        ))}
      </CardContent>
    </Card>
  )
}

const field = 'w-full rounded-md border bg-background px-3 py-2 text-sm'

function PolicyForm({ id, policy, he }: { id: string; policy: BotPolicy; he: boolean }) {
  const tr = (h: string, e: string) => (he ? h : e)
  const save = useSaveBotPolicy(id)
  const [limit, setLimit] = useState(String(policy.daily_limit_per_user ?? 0))
  const [limitReply, setLimitReply] = useState(policy.limit_reply ?? '')
  const [allow, setAllow] = useState((policy.allow_list ?? []).join('\n'))
  const [allowReply, setAllowReply] = useState(policy.allow_reply ?? '')
  const [prices, setPrices] = useState(policy.show_prices !== false)
  const [exemptUi, setExemptUi] = useState((policy.exempt_channels ?? ['ui']).includes('ui'))

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{tr('הגבלות שימוש', 'Usage limits')}</CardTitle>
        <p className="text-xs text-muted-foreground">{tr('נכנס לתוקף מיד, בלי הפעלה מחדש', 'Takes effect immediately, no restart')}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={prices} onChange={(e) => setPrices(e.target.checked)} className="h-4 w-4" />
          {tr('להציג מחירים בתשובות', 'Show prices in answers')}
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <div className="text-sm font-medium">{tr('שאלות ליום לכל משתמש (0 = ללא הגבלה)', 'Questions per user per day (0 = no limit)')}</div>
            <Input type="number" min={0} value={limit} onChange={(e) => setLimit(e.target.value)} className="max-w-32" />
            <textarea className={field} rows={2} value={limitReply} onChange={(e) => setLimitReply(e.target.value)}
                      placeholder={tr('ההודעה כשמגיעים למכסה', 'Message when the limit is reached')} />
          </div>
          <div className="space-y-1">
            <div className="text-sm font-medium">{tr('מי מורשה (שורה לכל טלפון / משתמש טלגרם / שם צ׳אט; ריק = כולם)', 'Who may use it (one phone / Telegram user / chat name per line; empty = everyone)')}</div>
            <textarea className={field} rows={4} dir="ltr" value={allow} onChange={(e) => setAllow(e.target.value)} />
            <textarea className={field} rows={2} value={allowReply} onChange={(e) => setAllowReply(e.target.value)}
                      placeholder={tr('ההודעה למי שלא ברשימה', 'Message for someone not on the list')} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={exemptUi} onChange={(e) => setExemptUi(e.target.checked)} className="h-4 w-4" />
          {tr('הקונסולה של הצוות לא כפופה להגבלות', 'Staff console is exempt from the limits')}
        </label>
        <div className="flex items-center gap-3">
          <Button disabled={save.isPending} onClick={() => save.mutate({
            daily_limit_per_user: Math.max(0, parseInt(limit || '0', 10) || 0), limit_reply: limitReply,
            allow_list: allow.split('\n').map((x) => x.trim()).filter(Boolean), allow_reply: allowReply,
            show_prices: prices, exempt_channels: exemptUi ? ['ui'] : [],
          })}>{tr('שמור', 'Save')}</Button>
          {save.isSuccess && <span className="text-sm text-emerald-600">{tr('נשמר', 'Saved')}</span>}
          {save.error && <span className="text-sm text-destructive">{(save.error as Error).message}</span>}
        </div>
      </CardContent>
    </Card>
  )
}

function BrandsForm({ id, brands, he }: { id: string; brands: BotBrands; he: boolean }) {
  const tr = (h: string, e: string) => (he ? h : e)
  const save = useSaveBotBrands(id)
  const [only, setOnly] = useState(brands.CATALOG_ONLY_BRANDS)
  const [reply, setReply] = useState(brands.CATALOG_ONLY_BRANDS_REPLY)
  const [refuseCars, setRefuseCars] = useState(brands.CATALOG_CAR_REFUSE_BRANDS)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{tr('מותגים', 'Brands')}</CardTitle>
        <p className="text-xs text-muted-foreground">{tr('שמירה מפעילה מחדש את הקטלוג (כדקה)', 'Saving restarts the catalogue (about a minute)')}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <div className="text-sm font-medium">{tr('מותגים שהבוט עונה עליהם (מופרד בפסיקים, למשל byd,geely)', 'Brands it answers (comma-separated, e.g. byd,geely)')}</div>
          <Input dir="ltr" value={only} onChange={(e) => setOnly(e.target.value)} />
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium">{tr('תשובה לרכב ממותג אחר', 'Reply for a car of another brand')}</div>
          <Input value={reply} onChange={(e) => setReply(e.target.value)} />
        </div>
        <div className="space-y-1">
          <div className="text-sm font-medium">{tr('מותגים שעונים רק לפי מק״ט, לא לפי רכב', 'Brands answered by part number only, not by car')}</div>
          <Input dir="ltr" value={refuseCars} onChange={(e) => setRefuseCars(e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          <Button disabled={save.isPending}
                  onClick={() => save.mutate({ CATALOG_ONLY_BRANDS: only, CATALOG_ONLY_BRANDS_REPLY: reply, CATALOG_CAR_REFUSE_BRANDS: refuseCars })}>
            {save.isPending ? tr('שומר ומפעיל מחדש…', 'Saving & restarting…') : tr('שמור', 'Save')}
          </Button>
          {save.isSuccess && <span className="text-sm text-emerald-600">{save.data?.restart_ok ? tr('נשמר והופעל מחדש', 'Saved and restarted') : tr('נשמר, ההפעלה מחדש נכשלה', 'Saved; restart failed')}</span>}
          {save.error && <span className="text-sm text-destructive">{(save.error as Error).message}</span>}
        </div>
      </CardContent>
    </Card>
  )
}

function TelegramCard({ id, tg, policy, he }: { id: string; tg: BotTelegram; policy: BotPolicy; he: boolean }) {
  const tr = (h: string, e: string) => (he ? h : e)
  const save = useSaveBotTelegram(id)
  const savePolicy = useSaveBotPolicy(id)
  const [token, setToken] = useState('')
  const [auth, setAuth] = useState(policy.telegram_auth ?? 'none')
  const [code, setCode] = useState(policy.access_code ?? '')
  const [groups, setGroups] = useState((policy.telegram_groups ?? []).join('\n'))
  const link = tg.username ? `https://t.me/${tg.username}` : ''
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{tr('בוט טלגרם', 'Telegram bot')}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {tr('בוט נפרד לכל בוט — יוצרים ב־@BotFather ומדביקים כאן את הטוקן. עונה בצ׳אטים פרטיים; ההגבלות למעלה חלות גם עליו.',
              'One bot per bot — create it in @BotFather and paste its token here. Answers private chats; the limits apply to it too.')}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {tg.token_set ? (
            <>
              <Badge className={tg.running ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}>
                {tg.running ? tr('פעיל', 'Running') : tr('כבוי', 'Off')}
              </Badge>
              {link && <a href={link} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline" dir="ltr">@{tg.username}</a>}
              {tg.error && <span className="text-destructive">{tg.error}</span>}
              {tg.conflicts > 0 && <span className="text-destructive">{tr('הטוקן משמש בוט אחר — לא יופעל', 'Token used by another bot — will not start')}</span>}
            </>
          ) : (
            <span className="text-muted-foreground">{tr('אין עדיין טוקן', 'No token yet')}</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input type="password" dir="ltr" className="max-w-md" value={token} onChange={(e) => setToken(e.target.value)}
                 placeholder={tg.token_set ? tr('טוקן חדש (להחלפה)', 'New token (to replace)') : '123456:ABC…'} autoComplete="off" />
          <Button variant="outline" disabled={!token.trim() || save.isPending}
                  onClick={() => save.mutate({ token: token.trim() }, { onSuccess: () => setToken('') })}>
            {tr('שמור טוקן', 'Save token')}
          </Button>
          {tg.token_set && (
            <Button disabled={save.isPending || tg.conflicts > 0} variant={tg.running ? 'outline' : 'default'}
                    onClick={() => save.mutate({ enabled: !tg.running })}>
              {save.isPending ? tr('מבצע…', 'Working…') : tg.running ? tr('כבה טלגרם', 'Turn off') : tr('הפעל טלגרם', 'Turn on')}
            </Button>
          )}
        </div>
        {save.isPending && <p className="text-xs text-muted-foreground">{tr('הפעלה ראשונה בונה את השירות — עד כמה דקות', 'The first start builds the service — up to a few minutes')}</p>}
        <div className="space-y-2 border-t pt-3">
          <div className="text-sm font-medium">{tr('כניסה לבוט', 'Who can log in')}</div>
          <select className="w-full max-w-md rounded-md border bg-background px-3 py-2 text-sm" value={auth}
                  onChange={(e) => setAuth(e.target.value as NonNullable<BotPolicy['telegram_auth']>)}>
            <option value="none">{tr('פתוח לכולם', 'Open to everyone')}</option>
            <option value="phone">{tr('טלפון מאומת (מספרים מהרשימה למטה)', 'Verified phone (numbers from the list below)')}</option>
            <option value="code">{tr('קוד גישה', 'Access code')}</option>
            <option value="phone_or_code">{tr('טלפון מאומת או קוד גישה', 'Verified phone or access code')}</option>
          </select>
          {(auth === 'code' || auth === 'phone_or_code') && (
            <Input dir="ltr" className="max-w-md" value={code} onChange={(e) => setCode(e.target.value)}
                   placeholder={tr('קוד גישה (המשתמש שולח: /login הקוד)', 'Access code (the user sends: /login CODE)')} />
          )}
          {(auth === 'phone' || auth === 'phone_or_code') && !(policy.allow_list ?? []).some((x) => x.replace(/\D/g, '').length >= 9) && (
            <p className="text-sm text-destructive">
              {tr('אין אף מספר טלפון ברשימת "מי מורשה" למטה — באימות טלפון אף אחד לא יוכל להיכנס.',
                  'No phone number on the "Who may use it" list below — with phone login nobody can get in.')}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {tr('שינוי הקוד או הסרת טלפון מהרשימה מנתקים את המשתמשים האלה מיד.', 'Changing the code or removing a phone logs those users out immediately.')}
          </p>
          <div className="space-y-1">
            <div className="text-sm font-medium">{tr('קבוצות שהבוט עונה בהן (שורה לכל מזהה קבוצה, למשל ‎-5352661582)', 'Groups the bot answers in (one group id per line, e.g. -5352661582)')}</div>
            <textarea className="w-full max-w-md rounded-md border bg-background px-3 py-2 text-sm" rows={2} dir="ltr"
                      value={groups} onChange={(e) => setGroups(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              {tr('כל מי שבקבוצה מקבל תשובות (המכסה היומית נספרת לכל אדם). כדי שהבוט יראה כל הודעה בקבוצה: ב־@BotFather → ‎/setprivacy → Disable, או להפוך אותו למנהל בקבוצה.',
                  'Everyone in the group is answered (the daily limit counts per person). For the bot to see every group message: @BotFather → /setprivacy → Disable, or make it a group admin.')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" disabled={savePolicy.isPending || ((auth === 'code' || auth === 'phone_or_code') && !code.trim())}
                    onClick={() => savePolicy.mutate({ telegram_auth: auth, access_code: code.trim(), telegram_groups: groups.split('\n').map((x) => x.trim().replace(/^#/, '')).filter(Boolean) })}>{tr('שמור כניסה', 'Save login')}</Button>
            {savePolicy.isSuccess && <span className="text-sm text-emerald-600">{tr('נשמר', 'Saved')}</span>}
            {savePolicy.error && <span className="text-sm text-destructive">{(savePolicy.error as Error).message}</span>}
          </div>
        </div>
        {save.error && <p className="text-sm text-destructive">{(save.error as Error).message}</p>}
      </CardContent>
    </Card>
  )
}
