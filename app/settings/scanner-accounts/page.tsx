'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown, ArrowUpToLine, CheckCircle2, Eye, EyeOff, Info, KeyRound, Lock, Pencil,
  RefreshCw, ServerCog, ShieldAlert, Unlock, XCircle,
} from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useLocale } from '@/lib/locale-context'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import type { Change, ProviderView, RungView } from '@/lib/scanner-accounts'

/**
 * /settings/scanner-accounts — which portal login each scanner uses, and the
 * order it falls back in when a login fails.
 *
 * Reading needs a signed-in session and shows no passwords. Every change (and
 * every reveal) sends the settings password, checked on the server each time;
 * it lives only in this page's memory. Scanners read their login once per
 * container, so a saved change shows as "not applied" until the scanner is
 * refreshed — the save form does that by default.
 */

interface LambdaState { name: string; region: string; refreshedAt: string | null; error?: string }
type Provider = Omit<ProviderView, 'lambdas'> & { lambdas: LambdaState[] }
interface Payload { editable: boolean; providers: Provider[] }
interface PostResult { ok?: boolean; password?: string; applied?: { name: string; ok: boolean; error?: string }[] }

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

/** Has every scanner of this provider been refreshed since its newest account change? */
function syncState(p: Provider): 'synced' | 'pending' | 'unknown' {
  const changed = p.rungs.map((r) => r.meta.changedAt).filter(Boolean).sort().pop()
  if (!changed) return 'synced'
  if (p.lambdas.some((l) => !l.refreshedAt)) return 'unknown'
  return p.lambdas.every((l) => (l.refreshedAt as string) >= changed) ? 'synced' : 'pending'
}

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
      throw new Error(out?.error || String(res.status))
    }
    return out
  }

  const reportApplied = (r: PostResult) => {
    const failed = (r.applied ?? []).filter((a) => !a.ok)
    if (failed.length) {
      toast.error((isHe ? 'הסורק לא רוענן: ' : 'Scanner not refreshed: ') + failed.map((f) => `${f.name} — ${f.error}`).join('; '))
    } else if (r.applied?.length) {
      toast.success(isHe ? 'הסורקים רועננו — סריקות חדשות ישתמשו בפרטים החדשים' : 'Scanners refreshed — new scans use the new login')
    }
  }

  const mutation = useMutation({
    mutationFn: post,
    onSuccess: (r, vars) => {
      if (vars.change) toast.success(isHe ? 'נשמר' : 'Saved')
      reportApplied(r)
      qc.invalidateQueries({ queryKey: ['scanner-accounts'] })
    },
    onError: (e: Error) => toast.error(e.message === 'wrong password' ? (isHe ? 'סיסמת הגדרות שגויה' : 'Wrong settings password') : e.message),
  })

  const act = (provider: string, body: { change?: Change; apply?: boolean }) => mutation.mutate({ provider, ...body })

  return (
    <div className="space-y-4">
      <PageHeader
        icon={KeyRound}
        title={isHe ? 'חשבונות סורקים' : 'Scanner accounts'}
        description={isHe
          ? 'עם איזה משתמש כל סורק מתחבר לפורטל, ולאן הוא עובר כשההתחברות נכשלת.'
          : 'Which login each scanner uses on its portal, and where it goes when that login fails.'}
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
            <form
              className="flex w-full flex-wrap items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); if (password) setUnlocked(true) }}
            >
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
            onAct={(body) => act(p.id, body)}
            onReveal={(rung) => post({ provider: p.id, reveal: rung })}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        {isHe
          ? 'כל שמירה יוצרת גרסה חדשה של הסוד config ב-AWS (הקודמת נשמרת תחת AWSPREVIOUS). כיבוי חשבון לא מוחק אותו — הפרטים נשמרים בצד ומוחזרים בהדלקה. רענון סורק לא עוצר סריקות רצות; הן מסתיימות עם הפרטים הקודמים.'
          : 'Every save writes a new version of the config secret in AWS (the previous one stays under AWSPREVIOUS). Switching an account off never deletes it — it is set aside and comes back when switched on. Refreshing a scanner does not stop running scans; they finish on the previous login.'}
      </p>
    </div>
  )
}

function ProviderCard({ provider: p, isHe, unlocked, busy, onAct, onReveal }: {
  provider: Provider
  isHe: boolean
  unlocked: boolean
  busy: boolean
  onAct: (body: { change?: Change; apply?: boolean }) => void
  onReveal: (rung: string) => Promise<PostResult>
}) {
  const rel = useRelative(isHe)
  const sync = syncState(p)
  const active = p.rungs.filter((r) => r.active).length
  const editable = unlocked && !p.readOnly
  const dealers = p.rungs.filter((r) => r.kind === 'dealer')

  return (
    <Card className={cn(p.readOnly && 'opacity-80')}>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{isHe ? p.nameHe : p.nameEn}</h2>
            <p className="text-xs text-muted-foreground">
              {p.readOnly
                ? (isHe ? 'לא ניתן לעריכה כאן' : 'Not editable here')
                : p.fallbackSupported
                  ? (isHe ? `${active} מתוך ${p.rungs.length} חשבונות פעילים בשרשרת` : `${active} of ${p.rungs.length} accounts active in the chain`)
                  : (isHe ? 'חשבון אחד · ללא גיבוי' : 'One account · no fallback')}
            </p>
          </div>
          {!p.readOnly && (sync === 'pending' ? (
            <div className="flex items-center gap-2">
              <Badge variant="warning">{isHe ? 'השינוי עוד לא נקלט בסורק' : 'Change not picked up yet'}</Badge>
              <Button type="button" size="sm" className="h-8" disabled={!unlocked || busy} onClick={() => onAct({ apply: true })}
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

        <ol className="space-y-0">
          {p.rungs.map((r, i) => (
            <li key={r.id}>
              <RungRow
                rung={r}
                step={i + 1}
                isHe={isHe}
                editable={editable}
                busy={busy}
                canPromote={r.kind === 'dealer' && dealers.length === 2 && r.id !== dealers[0].id}
                onChange={(change, apply) => onAct({ change, apply })}
                onPromote={() => onAct({ change: { op: 'swap', a: dealers[0].id, b: r.id }, apply: true })}
                onReveal={() => onReveal(r.id)}
                rel={rel}
              />
              <Connector isHe={isHe} />
            </li>
          ))}
          {!p.fallbackSupported && !p.readOnly && (
            <li>
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                {isHe
                  ? 'חשבון גיבוי — הסורק הזה עוד לא יודע לעבור לחשבון שני. נדרש עדכון קטן בסורק (קוד ההתחברות המשותף כבר תומך בזה).'
                  : 'Fallback account — this scanner cannot switch to a second account yet. It needs a small scanner update (the shared login code already supports it).'}
              </div>
              <Connector isHe={isHe} />
            </li>
          )}
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

function RungRow({ rung: r, step, isHe, editable, busy, canPromote, onChange, onPromote, onReveal, rel }: {
  rung: RungView
  step: number
  isHe: boolean
  editable: boolean
  busy: boolean
  canPromote: boolean
  onChange: (change: Change, apply: boolean) => void
  onPromote: () => void
  onReveal: () => Promise<PostResult>
  rel: (iso?: string | null) => string
}) {
  const [editing, setEditing] = useState(false)
  const [username, setUsername] = useState(r.username)
  const [newPassword, setNewPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [apply, setApply] = useState(true)
  const [revealed, setRevealed] = useState<string | null>(null)

  // A revealed password hides itself again after 20 seconds.
  useEffect(() => {
    if (revealed === null) return
    const t = setTimeout(() => setRevealed(null), 20_000)
    return () => clearTimeout(t)
  }, [revealed])
  // Locking the page closes the form and hides a revealed password without resetting state.
  const isEditing = editing && editable
  const shown = editable ? revealed : null

  const incomplete = !r.parked && !r.active && (r.username || r.hasPassword)
  const empty = !r.parked && !r.username && !r.hasPassword
  const status = r.active
    ? { text: isHe ? 'פעיל' : 'Active', cls: 'bg-success text-white' }
    : r.sameAs && !r.parked
      ? { text: isHe ? 'זהה לחשבון קודם — מדולג' : 'Same as an earlier account — skipped', cls: 'bg-warning text-white' }
    : r.parked
      ? { text: isHe ? 'כבוי — מדולג' : 'Off — skipped', cls: 'bg-muted text-muted-foreground' }
      : incomplete
        ? { text: isHe ? 'חסר — מדולג' : 'Incomplete — skipped', cls: 'bg-warning text-white' }
        : { text: isHe ? 'לא מוגדר' : 'Not set', cls: 'bg-muted text-muted-foreground' }

  const save = () => {
    const change: Change = { op: 'set', rung: r.id }
    if (username.trim() && username.trim() !== r.username) change.username = username.trim()
    if (newPassword) change.password = newPassword
    if (change.username === undefined && change.password === undefined) { setEditing(false); return }
    onChange(change, apply)
    setEditing(false); setNewPassword(''); setShowNew(false)
  }

  return (
    <div className={cn('rounded-md border p-3', r.active ? 'border-border' : 'border-dashed bg-muted/20')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold', status.cls)}>{step}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{isHe ? r.labelHe : r.labelEn}</span>
            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', status.cls)}>{status.text}</span>
          </div>
          {!empty && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="font-mono text-foreground" dir="ltr">{r.username || '—'}</span>
              <span className="font-mono" dir="ltr">
                {shown !== null ? shown || '—' : r.hasPassword ? '••••••••' : (isHe ? 'אין סיסמה' : 'no password')}
              </span>
              {r.meta.changedAt && (
                <span>{isHe ? 'שונה ' : 'changed '}{rel(r.meta.changedAt)}{r.meta.changedBy ? ` · ${r.meta.changedBy.split('@')[0]}` : ''}</span>
              )}
            </div>
          )}
        </div>

        {editable && !isEditing && (
          <div className="flex items-center gap-1">
            {r.hasPassword && (
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={busy}
                title={revealed !== null ? (isHe ? 'הסתר סיסמה' : 'Hide password') : (isHe ? 'הצג סיסמה' : 'Show password')}
                onClick={async () => {
                  if (revealed !== null) { setRevealed(null); return }
                  try { setRevealed((await onReveal()).password ?? '') } catch (e) { toast.error((e as Error).message) }
                }}>
                {revealed !== null ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            )}
            {canPromote && r.active && (
              <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={busy}
                title={isHe ? 'הפוך לחשבון הראשי' : 'Make this the primary account'} onClick={onPromote}>
                <ArrowUpToLine className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={busy}
              title={isHe ? 'ערוך' : 'Edit'} onClick={() => { setUsername(r.username); setEditing(true) }}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {r.toggleable && (r.parked || !!r.username || r.hasPassword) && (
              <Switch
                checked={!r.parked}
                disabled={busy}
                label={r.parked ? (isHe ? 'הדלק חשבון' : 'Switch on') : (isHe ? 'כבה חשבון' : 'Switch off')}
                onChange={(on) => onChange({ op: 'toggle', rung: r.id, enabled: on }, true)}
              />
            )}
          </div>
        )}
      </div>

      {isEditing && (
        <form className="mt-3 grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save() }}>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">{isHe ? 'שם משתמש' : 'Username'}</span>
            <Input id={`${r.id}-username`} value={username} onChange={(e) => setUsername(e.target.value)}
              className="h-8 font-mono text-sm" dir="ltr" autoComplete="off" />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">{isHe ? 'סיסמה חדשה (ריק = ללא שינוי)' : 'New password (empty = keep)'}</span>
            <div className="relative">
              <Input id={`${r.id}-password`} type={showNew ? 'text' : 'password'} value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} className="h-8 pe-9 font-mono text-sm" dir="ltr" autoComplete="new-password" />
              <button type="button" className="absolute inset-y-0 end-0 flex w-8 items-center justify-center text-muted-foreground"
                onClick={() => setShowNew((s) => !s)} aria-label={showNew ? 'hide' : 'show'}>
                {showNew ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </label>
          <label className="flex items-center gap-2 text-xs sm:col-span-2">
            <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} className="h-3.5 w-3.5" />
            {isHe ? 'החל על הסורקים מיד (סריקות רצות יסתיימו עם הפרטים הקודמים)' : 'Apply to the scanners now (running scans finish on the old login)'}
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" className="h-8" disabled={busy || (!newPassword && username.trim() === r.username) || !username.trim()}>
              {isHe ? 'שמור' : 'Save'}
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => { setEditing(false); setNewPassword('') }}>
              {isHe ? 'ביטול' : 'Cancel'}
            </Button>
          </div>
        </form>
      )}
    </div>
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
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-success' : 'bg-muted-foreground/30',
      )}
    >
      <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4 rtl:-translate-x-4' : 'translate-x-0.5 rtl:-translate-x-0.5')} />
    </button>
  )
}
