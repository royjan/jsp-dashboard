'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown, ArrowUp, CheckCircle2, Eye, EyeOff, Info, KeyRound, Lock, Pencil, Plus,
  RefreshCw, ServerCog, ShieldAlert, Trash2, Unlock, XCircle,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useLocale } from '@/lib/locale-context'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import type { AccountView, Change, Portal, ProviderView } from '@/lib/scanner-accounts'

/**
 * /settings/scanner-accounts — the portal logins each scanner uses, in the
 * order it tries them (a primary + up to 5 fallbacks).
 *
 * Reading needs a signed-in session and shows no passwords. Every change (and
 * every reveal) sends the settings password, checked on the server each time;
 * it lives only in this page's memory. Scanners read their logins once per
 * container, so a saved change shows as "not picked up" until the scanner is
 * refreshed — saving does that by default.
 */

interface LambdaState { name: string; region: string; refreshedAt: string | null; error?: string }
type Provider = Omit<ProviderView, 'lambdas'> & { lambdas: LambdaState[]; onPremSynced?: boolean | null }
interface Payload { editable: boolean; providers: Provider[] }
interface PostResult {
  ok?: boolean
  password?: string
  applied?: { name: string; ok: boolean; error?: string }[]
  onPrem?: { ok: boolean; error?: string }
}
type Act = (body: { change?: Change; apply?: boolean }) => Promise<void>

function useRelative(isHe: boolean) {
  const rtf = new Intl.RelativeTimeFormat(isHe ? 'he' : 'en', { numeric: 'auto' })
  return (iso?: string | null) => {
    if (!iso) return ''
    const s = (new Date(iso).getTime() - Date.now()) / 1000
    const steps: [Intl.RelativeTimeFormatUnit, number][] = [['day', 86400], ['hour', 3600], ['minute', 60]]
    for (const [unit, sec] of steps) if (Math.abs(s) >= sec) return rtf.format(Math.round(s / sec), unit)
    return rtf.format(Math.round(s), 'second')
  }
}

/** Has every scanner of this provider been refreshed since its last account change? */
function syncState(p: Provider): 'synced' | 'pending' | 'unknown' {
  if (!p.changedAt) return 'synced'
  if (p.lambdas.some((l) => !l.refreshedAt)) return 'unknown'
  return p.lambdas.every((l) => (l.refreshedAt as string) >= (p.changedAt as string)) ? 'synced' : 'pending'
}

const portalLabel = (portal: Portal, isHe: boolean, multi: boolean) =>
  !multi ? (isHe ? 'חשבון' : 'Account')
    : portal === 'public' ? (isHe ? 'פורטל ציבורי' : 'Public portal') : (isHe ? 'סוכן' : 'Dealer')

export default function ScannerAccountsPage() {
  const { locale } = useLocale()
  const isHe = locale === 'he'
  const qc = useQueryClient()
  const [password, setPassword] = useState('')
  const [unlocked, setUnlocked] = useState(false)

  const q = useQuery<Payload>({
    queryKey: ['scanner-accounts'],
    queryFn: async () => {
      const res = await fetch('/api/settings/scanner-accounts')
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || String(res.status))
      return res.json()
    },
    staleTime: 30 * 1000,
    retry: false,
  })

  const post = async (body: Record<string, unknown>): Promise<PostResult> => {
    const res = await fetch('/api/settings/scanner-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password, ...body }),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) {
      if (res.status === 403 && out?.error === 'wrong password') { setUnlocked(false); setPassword('') }
      throw new Error(out?.error === 'wrong password' ? (isHe ? 'סיסמת הגדרות שגויה' : 'Wrong settings password') : out?.error || String(res.status))
    }
    return out
  }

  const mutation = useMutation({
    mutationFn: post,
    onSuccess: (r, vars) => {
      const failed = (r.applied ?? []).filter((a) => !a.ok)
      if (r.onPrem && !r.onPrem.ok) {
        toast.error((isHe ? 'נשמר בענן, אבל לא ב-Redis של השרתים המקומיים (.179 / VPS): ' : 'Saved to the cloud, but not to the on-prem Redis (.179 / VPS): ') + (r.onPrem.error ?? ''))
      }
      if (failed.length) {
        toast.error((isHe ? 'נשמר, אבל הסורק לא רוענן: ' : 'Saved, but a scanner was not refreshed: ') + failed.map((f) => `${f.name} — ${f.error}`).join('; '))
      } else if (r.applied?.length) {
        toast.success(vars.change
          ? (isHe ? 'נשמר והסורקים רועננו — סריקות חדשות ישתמשו בזה' : 'Saved and scanners refreshed — new scans use it')
          : (isHe ? 'הסורקים רועננו' : 'Scanners refreshed'))
      } else if (vars.change) {
        toast.success(isHe ? 'נשמר' : 'Saved')
      }
      qc.invalidateQueries({ queryKey: ['scanner-accounts'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      <PageHeader
        icon={KeyRound}
        title={isHe ? 'חשבונות סורקים' : 'Scanner accounts'}
        description={isHe
          ? 'עם אילו משתמשים כל סורק מתחבר לפורטל, ובאיזה סדר: הראשון ברשימה קודם, ואם ההתחברות נכשלת — הבא בתור.'
          : 'Which logins each scanner uses on its portal, in order: the first in the list first, and the next one whenever a login fails.'}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          {unlocked ? (
            <>
              <Unlock className="h-4 w-4 text-warning" />
              <span className="text-sm">{isHe ? 'עריכה פתוחה' : 'Editing unlocked'}</span>
              <Button type="button" size="sm" variant="ghost" className="ms-auto h-8" onClick={() => { setUnlocked(false); setPassword('') }}>
                <Lock className="me-1 h-3.5 w-3.5" />{isHe ? 'נעל' : 'Lock'}
              </Button>
            </>
          ) : q.data && !q.data.editable ? (
            <>
              <Lock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {isHe ? 'לצפייה בלבד · עריכה כבויה: SETTINGS_EDIT_PASSWORD לא מוגדר באפליקציה' : 'View only · editing is off: SETTINGS_EDIT_PASSWORD is not set on the app'}
              </span>
            </>
          ) : (
            <form className="flex w-full flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (password) setUnlocked(true) }}>
              <Lock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{isHe ? 'לצפייה בלבד' : 'View only'}</span>
              <input type="text" name="username" autoComplete="username" value="dashboard-settings" readOnly hidden />
              <Input
                id="scanner-accounts-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isHe ? 'סיסמת הגדרות' : 'settings password'}
                className="ms-auto h-8 w-56 text-sm"
              />
              <Button type="submit" size="sm" variant="outline" className="h-8" disabled={!password}>
                <Unlock className="me-1 h-3.5 w-3.5" />{isHe ? 'פתח לעריכה' : 'Unlock'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {q.isLoading && <div className="h-72 animate-pulse rounded-md bg-muted/40" />}
      {q.error && (
        <p className="text-sm text-destructive">{isHe ? 'לא ניתן לקרוא את החשבונות: ' : 'Could not read the accounts: '}{(q.error as Error).message}</p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {q.data?.providers.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            isHe={isHe}
            unlocked={unlocked}
            busy={mutation.isPending}
            act={(body) => mutation.mutateAsync({ provider: p.id, ...body }).then(() => undefined)}
            reveal={(id) => post({ provider: p.id, reveal: id })}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {isHe
          ? 'כל שמירה יוצרת גרסה חדשה של הסוד config ב-AWS (הקודמת נשמרת תחת AWSPREVIOUS). החשבונות נשמרים ברשימה אחת לכל ספק (למשל PSA_ACCOUNTS), והמפתחות הישנים (PSA_USERNAME וכו׳) מתעדכנים אוטומטית לחשבונות הראשונים. רענון סורק לא עוצר סריקות רצות; הן מסתיימות עם הפרטים הקודמים.'
          : 'Every save writes a new version of the config secret in AWS (the previous one stays under AWSPREVIOUS). Accounts are stored as one list per provider (e.g. PSA_ACCOUNTS); the old keys (PSA_USERNAME etc.) are kept in step with the first accounts automatically. Refreshing a scanner does not stop running scans; they finish on the previous login.'}
      </p>
    </div>
  )
}

function ProviderCard({ provider: p, isHe, unlocked, busy, act, reveal }: {
  provider: Provider
  isHe: boolean
  unlocked: boolean
  busy: boolean
  act: Act
  reveal: (id: string) => Promise<PostResult>
}) {
  const rel = useRelative(isHe)
  const [adding, setAdding] = useState(false)
  const sync = syncState(p)
  const used = p.accounts.filter((a) => a.usedNow).length
  const editable = unlocked && !p.readOnly
  const multiPortal = p.portals.length > 1
  const full = p.accounts.length >= p.maxAccounts

  return (
    <Card className={cn(p.readOnly && 'opacity-80')}>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{isHe ? p.nameHe : p.nameEn}</h2>
            <p className="text-xs text-muted-foreground">
              {p.readOnly
                ? (isHe ? 'לא ניתן לעריכה כאן' : 'Not editable here')
                : isHe
                  ? `${p.accounts.length} מתוך ${p.maxAccounts} חשבונות · ${used} בשימוש הסורק`
                  : `${p.accounts.length} of ${p.maxAccounts} accounts · ${used} used by the scanner`}
            </p>
          </div>
          {!p.readOnly && (sync === 'pending' || p.onPremSynced === false ? (
            <div className="flex items-center gap-2">
              <Badge variant="warning">
                {sync === 'pending'
                  ? (isHe ? 'השינוי עוד לא נקלט בסורק' : 'Change not picked up yet')
                  : (isHe ? 'העותק בשרתים המקומיים לא מעודכן' : 'On-prem copy out of step')}
              </Badge>
              <Button type="button" size="sm" className="h-8" disabled={!unlocked || busy} onClick={() => act({ apply: true })}
                title={unlocked ? undefined : (isHe ? 'פתח לעריכה קודם' : 'Unlock editing first')}>
                <RefreshCw className="me-1 h-3.5 w-3.5" />{isHe ? 'החל עכשיו' : 'Apply now'}
              </Button>
            </div>
          ) : sync === 'synced' ? (
            <Badge variant="success"><CheckCircle2 className="me-1 h-3 w-3" />{isHe ? 'הסורק מעודכן' : 'Scanner up to date'}</Badge>
          ) : (
            <Badge variant="outline">{isHe ? 'מצב הסורק לא ידוע' : 'Scanner state unknown'}</Badge>
          ))}
        </div>

        {p.readOnly && (
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            {isHe ? p.readOnlyReasonHe : p.readOnlyReasonEn}
          </p>
        )}
        {!p.readOnly && !p.scannerReadsList && p.accounts.length > 1 && (
          <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            {isHe
              ? 'הסורק הזה עוד משתמש רק בחשבון הראשון. חשבונות הגיבוי נשמרים ויופעלו אחרי עדכון הסורק.'
              : 'This scanner still uses only the first account. The fallbacks are saved and take effect once the scanner is updated.'}
          </p>
        )}

        <ol>
          {p.accounts.map((a, i) => (
            <li key={a.id}>
              <AccountRow
                account={a}
                step={i + 1}
                last={i === p.accounts.length - 1}
                isHe={isHe}
                multiPortal={multiPortal}
                editable={editable}
                busy={busy}
                act={act}
                reveal={() => reveal(a.id)}
                rel={rel}
              />
              <Connector isHe={isHe} />
            </li>
          ))}
          {editable && (adding ? (
            <li>
              <AddAccountForm isHe={isHe} portals={p.portals} busy={busy} onCancel={() => setAdding(false)}
                onAdd={async (change, apply) => { await act({ change, apply }); setAdding(false) }} />
              <Connector isHe={isHe} />
            </li>
          ) : (
            <li>
              <button type="button" disabled={full || busy} onClick={() => setAdding(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed p-2.5 text-xs text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60">
                <Plus className="h-3.5 w-3.5" />
                {full
                  ? (isHe ? `הגעת למקסימום — ${p.maxAccounts} חשבונות` : `Maximum reached — ${p.maxAccounts} accounts`)
                  : (isHe ? 'הוסף חשבון גיבוי' : 'Add a fallback account')}
              </button>
              <Connector isHe={isHe} />
            </li>
          ))}
          <li className="flex items-center gap-2 ps-1 text-xs text-muted-foreground">
            <XCircle className="h-4 w-4 text-destructive/70" />
            {isHe ? 'כל החשבונות נכשלו ← הסריקה נכשלת' : 'Every account failed → the scan fails'}
          </li>
        </ol>

        {(p.noteHe || p.noteEn) && (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />{isHe ? p.noteHe : p.noteEn}
          </p>
        )}

        {p.hasOnPrem && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <ServerCog className="h-3.5 w-3.5" />
            <span>{isHe ? 'שרתים מקומיים (portal-pilot ב-.179, סורקי VPS):' : 'On-prem (portal-pilot on .179, VPS walkers):'}</span>
            {p.onPremSynced === true ? (
              <Badge variant="success" className="text-[10px]">{isHe ? 'Redis מעודכן' : 'Redis in step'}</Badge>
            ) : p.onPremSynced === false ? (
              <Badge variant="warning" className="text-[10px]">{isHe ? 'לא מעודכן — לחיצה על "החל עכשיו" תעדכן' : 'out of step — "Apply now" updates it'}</Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">{isHe ? 'לא ידוע' : 'unknown'}</Badge>
            )}
            <span>{isHe ? 'נקלט באתחול הבא שלהם (הסורקים מתאתחלים כל לילה, 03:30 UTC).' : 'Picked up at their next restart (the walkers restart nightly at 03:30 UTC).'}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 border-t pt-3 text-xs text-muted-foreground">
          <ServerCog className="h-3.5 w-3.5" />
          <span>{isHe ? 'בשימוש:' : 'Used by:'}</span>
          {p.lambdas.map((l) => (
            <span key={l.name} className="rounded border px-1.5 py-0.5 font-mono" dir="ltr"
              title={l.error ? l.error : l.refreshedAt ? new Date(l.refreshedAt).toLocaleString() : undefined}>
              {l.name.replace(/-service-lambda|-lambda/, '')} · {l.region}
              {l.refreshedAt && <span className="text-muted-foreground/70"> · {rel(l.refreshedAt)}</span>}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function Connector({ isHe }: { isHe: boolean }) {
  return (
    <div className="flex items-center gap-2 py-1 ps-3.5 text-[11px] text-muted-foreground">
      <span className="h-4 border-s border-dashed" />
      <ArrowDown className="h-3 w-3" />
      {isHe ? 'אם ההתחברות נכשלת' : 'if the login fails'}
    </div>
  )
}

function AccountRow({ account: a, step, last, isHe, multiPortal, editable, busy, act, reveal, rel }: {
  account: AccountView
  step: number
  last: boolean
  isHe: boolean
  multiPortal: boolean
  editable: boolean
  busy: boolean
  act: Act
  reveal: () => Promise<PostResult>
  rel: (iso?: string | null) => string
}) {
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [revealed, setRevealed] = useState<string | null>(null)

  // A revealed password hides itself again after 20 seconds.
  useEffect(() => {
    if (revealed === null) return
    const t = setTimeout(() => setRevealed(null), 20_000)
    return () => clearTimeout(t)
  }, [revealed])
  // Locking the page closes forms and hides a revealed password without resetting state.
  const isEditing = editing && editable
  const isConfirming = confirmDelete && editable
  const shown = editable ? revealed : null

  const status = !a.enabled
    ? { text: isHe ? 'כבוי — מדולג' : 'Off — skipped', cls: 'bg-muted text-muted-foreground' }
    : a.sameAs
      ? { text: isHe ? 'כפול לחשבון קודם — מדולג' : 'Repeats an earlier account — skipped', cls: 'bg-warning text-white' }
      : !a.username || !a.hasPassword
        ? { text: isHe ? 'חסר — מדולג' : 'Incomplete — skipped', cls: 'bg-warning text-white' }
        : a.usedNow
          ? { text: step === 1 ? (isHe ? 'ראשי' : 'Primary') : (isHe ? 'גיבוי פעיל' : 'Active fallback'), cls: 'bg-success text-white' }
          : { text: isHe ? 'שמור — הסורק עוד לא משתמש בו' : 'Saved — not used by the scanner yet', cls: 'bg-muted text-muted-foreground' }
  const live = a.enabled && a.usedNow

  return (
    <div className={cn('rounded-md border p-3', live ? 'border-border' : 'border-dashed bg-muted/20')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold', status.cls)}>{step}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{portalLabel(a.portal, isHe, multiPortal)}</span>
            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', status.cls)}>{status.text}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span className="font-mono text-foreground" dir="ltr">{a.username || '—'}</span>
            <span className="font-mono" dir="ltr">
              {shown !== null ? shown || '—' : a.hasPassword ? '••••••••' : (isHe ? 'אין סיסמה' : 'no password')}
            </span>
            {a.changedAt && (
              <span>{isHe ? 'שונה ' : 'changed '}{rel(a.changedAt)}{a.changedBy ? ` · ${a.changedBy.split('@')[0]}` : ''}</span>
            )}
          </div>
        </div>

        {editable && !isEditing && !isConfirming && (
          <div className="flex items-center gap-0.5">
            {a.hasPassword && (
              <IconButton title={shown !== null ? (isHe ? 'הסתר סיסמה' : 'Hide password') : (isHe ? 'הצג סיסמה' : 'Show password')} disabled={busy}
                onClick={async () => {
                  if (shown !== null) { setRevealed(null); return }
                  try { setRevealed((await reveal()).password ?? '') } catch (e) { toast.error((e as Error).message) }
                }}>
                {shown !== null ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </IconButton>
            )}
            <IconButton title={isHe ? 'הזז למעלה בסדר' : 'Move up the order'} disabled={busy || step === 1}
              onClick={() => act({ change: { op: 'move', id: a.id, to: step - 2 }, apply: true })}>
              <ArrowUp className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton title={isHe ? 'הזז למטה בסדר' : 'Move down the order'} disabled={busy || last}
              onClick={() => act({ change: { op: 'move', id: a.id, to: step }, apply: true })}>
              <ArrowDown className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton title={isHe ? 'ערוך' : 'Edit'} disabled={busy} onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton title={isHe ? 'מחק' : 'Delete'} disabled={busy} onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </IconButton>
            <Switch
              checked={a.enabled}
              disabled={busy}
              label={a.enabled ? (isHe ? 'כבה חשבון' : 'Switch off') : (isHe ? 'הדלק חשבון' : 'Switch on')}
              onChange={(on) => act({ change: { op: 'toggle', id: a.id, enabled: on }, apply: true })}
            />
          </div>
        )}
      </div>

      {isConfirming && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-destructive/5 p-2 text-xs">
          <span>{isHe ? `למחוק את ${a.username}? אי אפשר לבטל מכאן (גרסה קודמת נשמרת ב-AWS).` : `Delete ${a.username}? This can't be undone here (AWS keeps the previous version).`}</span>
          <Button type="button" size="sm" variant="destructive" className="ms-auto h-7" disabled={busy}
            onClick={() => act({ change: { op: 'delete', id: a.id }, apply: true }).finally(() => setConfirmDelete(false))}>
            {isHe ? 'מחק' : 'Delete'}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={() => setConfirmDelete(false)}>
            {isHe ? 'ביטול' : 'Cancel'}
          </Button>
        </div>
      )}

      {isEditing && (
        <AccountForm
          isHe={isHe}
          busy={busy}
          initial={{ username: a.username }}
          passwordOptional
          submitLabel={isHe ? 'שמור' : 'Save'}
          onCancel={() => setEditing(false)}
          onSubmit={async ({ username, password }, apply) => {
            const change: Change = { op: 'update', id: a.id }
            if (username !== a.username) change.username = username
            if (password) change.password = password
            if (change.username === undefined && change.password === undefined) { setEditing(false); return }
            await act({ change, apply })
            setEditing(false)
          }}
        />
      )}
    </div>
  )
}

function AddAccountForm({ isHe, portals, busy, onAdd, onCancel }: {
  isHe: boolean
  portals: Portal[]
  busy: boolean
  onAdd: (change: Change, apply: boolean) => Promise<void>
  onCancel: () => void
}) {
  const [portal, setPortal] = useState<Portal>('dealer')
  return (
    <div className="rounded-md border border-primary/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"><Plus className="h-3.5 w-3.5" /></span>
        <span className="text-sm font-medium">{isHe ? 'חשבון חדש — נכנס בסוף הרשימה' : 'New account — goes to the end of the list'}</span>
        {portals.length > 1 && (
          <div className="ms-auto inline-flex rounded-md border p-0.5 text-xs" role="radiogroup" aria-label={isHe ? 'סוג פורטל' : 'Portal type'}>
            {portals.map((pt) => (
              <button key={pt} type="button" role="radio" aria-checked={portal === pt} onClick={() => setPortal(pt)}
                className={cn('rounded px-2 py-1', portal === pt ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>
                {portalLabel(pt, isHe, true)}
              </button>
            ))}
          </div>
        )}
      </div>
      <AccountForm
        isHe={isHe}
        busy={busy}
        initial={{ username: '' }}
        submitLabel={isHe ? 'הוסף' : 'Add'}
        onCancel={onCancel}
        onSubmit={({ username, password }, apply) =>
          onAdd({ op: 'add', username, password, portal }, apply)}
      />
    </div>
  )
}

function AccountForm({ isHe, busy, initial, passwordOptional, submitLabel, onSubmit, onCancel }: {
  isHe: boolean
  busy: boolean
  initial: { username: string }
  passwordOptional?: boolean
  submitLabel: string
  onSubmit: (v: { username: string; password: string }, apply: boolean) => Promise<void> | void
  onCancel: () => void
}) {
  const [username, setUsername] = useState(initial.username)
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [apply, setApply] = useState(true)
  const changed = username.trim() !== initial.username || !!password
  const valid = !!username.trim() && (passwordOptional || !!password) && changed

  return (
    <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={(e) => {
      e.preventDefault()
      if (valid) void onSubmit({ username: username.trim(), password }, apply)
    }}>
      <label className="space-y-1 text-xs">
        <span className="text-muted-foreground">{isHe ? 'שם משתמש' : 'Username'}</span>
        <Input value={username} onChange={(e) => setUsername(e.target.value)} className="h-8 font-mono text-sm" dir="ltr" autoComplete="off" />
      </label>
      <label className="space-y-1 text-xs">
        <span className="text-muted-foreground">
          {passwordOptional ? (isHe ? 'סיסמה חדשה (ריק = ללא שינוי)' : 'New password (empty = keep)') : (isHe ? 'סיסמה' : 'Password')}
        </span>
        <div className="relative">
          <Input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
            className="h-8 pe-9 font-mono text-sm" dir="ltr" autoComplete="new-password" />
          <button type="button" className="absolute inset-y-0 end-0 flex w-8 items-center justify-center text-muted-foreground"
            onClick={() => setShow((s) => !s)} aria-label={show ? 'hide' : 'show'}>
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </div>
      </label>
      <label className="flex items-center gap-2 text-xs sm:col-span-2">
        <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} className="h-3.5 w-3.5" />
        {isHe ? 'החל על הסורקים מיד (סריקות רצות יסתיימו עם הפרטים הקודמים)' : 'Apply to the scanners now (running scans finish on the old login)'}
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" size="sm" className="h-8" disabled={busy || !valid}>{submitLabel}</Button>
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={onCancel}>{isHe ? 'ביטול' : 'Cancel'}</Button>
      </div>
    </form>
  )
}

function IconButton({ title, disabled, onClick, children }: { title: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" size="icon" variant="ghost" className="h-8 w-8" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      {children}
    </Button>
  )
}

function Switch({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative ms-1 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-success' : 'bg-muted-foreground/30',
      )}
    >
      <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4 rtl:-translate-x-4' : 'translate-x-0.5 rtl:-translate-x-0.5')} />
    </button>
  )
}
