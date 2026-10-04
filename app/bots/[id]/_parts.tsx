'use client'

// The bot page's cards, shared by /bots/[id]/overview, /conversations and /limit (2026-10-04: one route per
// tab, so a link opens the tab - "/bots/byd/limit" - and the conversation filters live in the URL).
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatNumber } from '@/lib/constants'
import {
  useSaveBotPolicy, useSaveBotBrands, useSaveBotTelegram, useBotUsage, useResetUsage,
  type BotPolicy, type BotBrands, type BotTelegram, type GroupRule,
} from '@/lib/bots-admin'

export const CHANNEL_HE: Record<string, string> = { ui: 'קונסולה', telegram: 'טלגרם', whatsapp: 'וואטסאפ' }
export const REFUSAL_HE: Record<string, string> = { over_limit: 'מעל המכסה', not_allowed: 'לא מורשה', over_group_limit: 'מכסת הקבוצה' }

export function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  )
}

export function ListCard({ title, rows, empty }: { title: string; rows: [string, number][]; empty?: string }) {
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

export function PolicyForm({ id, policy, he }: { id: string; policy: BotPolicy; he: boolean }) {
  const tr = (h: string, e: string) => (he ? h : e)
  const save = useSaveBotPolicy(id)
  const [limit, setLimit] = useState(String(policy.daily_limit_per_user ?? 0))
  const [limitReply, setLimitReply] = useState(policy.limit_reply ?? '')
  const [allow, setAllow] = useState((policy.allow_list ?? []).join('\n'))
  const [allowReply, setAllowReply] = useState(policy.allow_reply ?? '')
  const [prices, setPrices] = useState(policy.show_prices !== false)
  const [exemptUi, setExemptUi] = useState((policy.exempt_channels ?? ['ui']).includes('ui'))
  const [counter, setCounter] = useState(!!policy.show_counter)

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
          <input type="checkbox" checked={counter} onChange={(e) => setCounter(e.target.checked)} className="h-4 w-4" />
          {tr('להציג מונה בתשובות — "(שאלה 3/50 היום)"', 'Show the counter in answers — "(question 3/50 today)"')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={exemptUi} onChange={(e) => setExemptUi(e.target.checked)} className="h-4 w-4" />
          {tr('הקונסולה של הצוות לא כפופה להגבלות', 'Staff console is exempt from the limits')}
        </label>
        <div className="flex items-center gap-3">
          <Button disabled={save.isPending} onClick={() => save.mutate({
            daily_limit_per_user: Math.max(0, parseInt(limit || '0', 10) || 0), limit_reply: limitReply,
            allow_list: allow.split('\n').map((x) => x.trim()).filter(Boolean), allow_reply: allowReply,
            show_prices: prices, exempt_channels: exemptUi ? ['ui'] : [], show_counter: counter,
          })}>{tr('שמור', 'Save')}</Button>
          {save.isSuccess && <span className="text-sm text-emerald-600">{tr('נשמר', 'Saved')}</span>}
          {save.error && <span className="text-sm text-destructive">{(save.error as Error).message}</span>}
        </div>
      </CardContent>
    </Card>
  )
}

export function BrandsForm({ id, brands, he }: { id: string; brands: BotBrands; he: boolean }) {
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

export function TelegramCard({ id, tg, policy, he }: { id: string; tg: BotTelegram; policy: BotPolicy; he: boolean }) {
  const tr = (h: string, e: string) => (he ? h : e)
  const save = useSaveBotTelegram(id)
  const savePolicy = useSaveBotPolicy(id)
  const [token, setToken] = useState('')
  const [auth, setAuth] = useState(policy.telegram_auth ?? 'none')
  const [code, setCode] = useState(policy.access_code ?? '')
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
          <div className="flex items-center gap-3">
            <Button variant="outline" disabled={savePolicy.isPending || ((auth === 'code' || auth === 'phone_or_code') && !code.trim())}
                    onClick={() => savePolicy.mutate({ telegram_auth: auth, access_code: code.trim() })}>{tr('שמור כניסה', 'Save login')}</Button>
            {savePolicy.isSuccess && <span className="text-sm text-emerald-600">{tr('נשמר', 'Saved')}</span>}
            {savePolicy.error && <span className="text-sm text-destructive">{(savePolicy.error as Error).message}</span>}
          </div>
        </div>
        {save.error && <p className="text-sm text-destructive">{(save.error as Error).message}</p>}
      </CardContent>
    </Card>
  )
}

export function UsageCard({ id, policy, he }: { id: string; policy: BotPolicy; he: boolean }) {
  const tr = (h: string, e: string) => (he ? h : e)
  const { data } = useBotUsage(id)
  const reset = useResetUsage(id)
  const save = useSaveBotPolicy(id)
  const own = policy.user_limits ?? {}
  const [edit, setEdit] = useState<Record<string, string>>({})
  const setOwn = (who: string, v: number | '') => {
    const next: Record<string, number | ''> = { ...own }
    if (v === '') delete next[who]
    else next[who] = v
    save.mutate({ user_limits: next as Record<string, number> }, { onSuccess: () => setEdit((e) => { const n = { ...e }; delete n[who]; return n }) })
  }
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <div>
          <CardTitle className="text-base">{tr('שימוש היום', 'Usage today')}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {tr('להגדיל למישהו: מכסה אישית (ריק = של הבוט) או ‎+10. המונה מתאפס לבד בחצות.', "To give someone more: a personal limit (blank = the bot's) or +10. Counts reset at midnight.")}
          </p>
        </div>
        {!!data?.users.length && (
          <Button size="sm" variant="outline" disabled={reset.isPending}
                  onClick={() => window.confirm(tr('לאפס את המונה של כולם להיום?', "Reset everyone's count for today?")) && reset.mutate('')}>
            {tr('איפוס לכולם', 'Reset all')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-1 text-sm">
        {!data?.users.length && <p className="text-muted-foreground">{tr('אין עדיין שאלות היום', 'No questions yet today')}</p>}
        {data?.users.map((u) => {
          const mine = own[u.who]
          const lim = mine ?? data.limit
          const val = edit[u.who] ?? (mine === undefined ? '' : String(mine))
          return (
            <div key={u.who} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 last:border-0">
              <span className="truncate" dir="auto">{u.who}</span>
              <span className="flex flex-wrap items-center gap-2">
                <span className={`tabular-nums ${lim && u.count >= lim ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>
                  {lim ? `${u.count}/${lim}` : u.count}{mine !== undefined && <span className="ms-1 text-xs">({tr('אישי', 'own')})</span>}
                </span>
                <Input type="number" min={0} className="h-7 w-20" value={val} placeholder={String(data.limit || '')}
                       onChange={(e) => setEdit((x) => ({ ...x, [u.who]: e.target.value }))} />
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={save.isPending || edit[u.who] === undefined}
                        onClick={() => setOwn(u.who, val === '' ? '' : Math.max(0, Number(val) || 0))}>{tr('שמור', 'Save')}</Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={save.isPending}
                        onClick={() => setOwn(u.who, (lim || 0) + 10)}>+10</Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={reset.isPending} onClick={() => reset.mutate(u.who)}>
                  {tr('איפוס', 'Reset')}
                </Button>
              </span>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

export function GroupsCard({ id, policy, he }: { id: string; policy: BotPolicy; he: boolean }) {
  const tr = (h: string, e: string) => (he ? h : e)
  const save = useSaveBotPolicy(id)
  const usage = useBotUsage(id)
  const reset = useResetUsage(id)
  const [ids, setIds] = useState<string[]>((policy.telegram_groups ?? []).map((x) => x.replace(/^#/, '').trim()).filter(Boolean))
  const [rules, setRules] = useState<Record<string, GroupRule>>(policy.group_limits ?? {})
  const [adding, setAdding] = useState('')
  const set = (gid: string, k: keyof GroupRule, v: string) =>
    setRules((r) => ({ ...r, [gid]: { ...(r[gid] ?? {}), [k]: k === 'limit_reply' ? v : (v === '' ? '' : Math.max(0, Number(v) || 0)) } }))
  const info = (gid: string) => usage.data?.groups.find((g) => g.id === gid)
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{tr('קבוצות טלגרם', 'Telegram groups')}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {tr('כל מי שבקבוצה מקבל תשובות. לכל קבוצה: מכסה לאדם (ריק = ברירת המחדל של הבוט), מכסה לכל הקבוצה ביום והודעה משלה. כדי שהבוט יראה כל הודעה: ב־@BotFather → ‎/setprivacy → Disable.',
              "Everyone in a group is answered. Per group: a per-person limit (blank = the bot's default), a daily cap for the whole group, and its own message. For the bot to see every message: @BotFather → /setprivacy → Disable.")}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {ids.length === 0 && <p className="text-sm text-muted-foreground">{tr('אין קבוצות', 'No groups')}</p>}
        {ids.map((gid) => {
          const r = rules[gid] ?? {}
          const g = info(gid)
          const cap = Number(r.daily_limit_group || 0)
          return (
            <div key={gid} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <span className="font-medium">{g?.title || tr('קבוצה', 'Group')}</span>{' '}
                  <span className="text-xs text-muted-foreground" dir="ltr">{gid}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className={`tabular-nums ${cap && (g?.count ?? 0) >= cap ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>
                    {tr('היום', 'Today')} {g?.count ?? 0}{cap ? `/${cap}` : ''}
                  </span>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={reset.isPending} onClick={() => reset.mutate(`group:${gid}`)}>
                    {tr('איפוס', 'Reset')}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive"
                          onClick={() => setIds((x) => x.filter((y) => y !== gid))}>{tr('הסר', 'Remove')}</Button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="space-y-1 text-xs text-muted-foreground">{tr('שאלות לאדם ביום (ריק = של הבוט)', 'Per person per day (blank = bot default)')}
                  <Input type="number" min={0} value={r.daily_limit_per_user ?? ''} onChange={(e) => set(gid, 'daily_limit_per_user', e.target.value)} />
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">{tr('שאלות לכל הקבוצה ביום (0 = ללא)', 'Whole group per day (0 = none)')}
                  <Input type="number" min={0} value={r.daily_limit_group ?? ''} onChange={(e) => set(gid, 'daily_limit_group', e.target.value)} />
                </label>
                <label className="space-y-1 text-xs text-muted-foreground">{tr('הודעה כשנגמרת המכסה (ריק = של הבוט)', "Message at the limit (blank = bot's)")}
                  <Input value={r.limit_reply ?? ''} onChange={(e) => set(gid, 'limit_reply', e.target.value)} />
                </label>
              </div>
            </div>
          )
        })}
        <div className="flex flex-wrap gap-2">
          <Input dir="ltr" className="max-w-56" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="-5352661582" />
          <Button variant="outline" disabled={!adding.trim()} onClick={() => {
            const gid = adding.trim().replace(/^#/, '')
            if (gid && !ids.includes(gid)) setIds((x) => [...x, gid])
            setAdding('')
          }}>{tr('הוסף קבוצה', 'Add group')}</Button>
          <Button disabled={save.isPending} onClick={() => save.mutate({
            telegram_groups: ids, group_limits: Object.fromEntries(ids.map((gid) => [gid, rules[gid] ?? {}])),
          })}>{tr('שמור קבוצות', 'Save groups')}</Button>
          {save.isSuccess && <span className="self-center text-sm text-emerald-600">{tr('נשמר', 'Saved')}</span>}
          {save.error && <span className="self-center text-sm text-destructive">{(save.error as Error).message}</span>}
        </div>
      </CardContent>
    </Card>
  )
}
