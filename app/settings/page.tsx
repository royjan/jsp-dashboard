'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings, Eye, EyeOff, Lock, Unlock, Plus, Trash2, Save, RotateCcw } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { useLocale } from '@/lib/locale-context'
import { toast } from '@/lib/toast'

/**
 * /settings — the app's Secrets Manager config.
 *
 * Anyone signed in can READ it: values are masked until revealed, one at a
 * time, so a screen share does not leak every key at once. CHANGING anything
 * asks for the settings password first; the password is checked on the
 * server on every save, never stored in the browser.
 */

interface KeyRow { key: string; value: string }
interface Payload { secretId: string; region: string; versionId?: string; createdDate?: string; keys: KeyRow[]; editable: boolean }

export default function SettingsPage() {
  const { locale } = useLocale()
  const isHe = locale === 'he'
  const qc = useQueryClient()

  const q = useQuery<Payload>({
    queryKey: ['settings-secrets'],
    queryFn: async () => {
      const res = await fetch('/api/settings/secrets')
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || String(res.status))
      return res.json()
    },
    staleTime: 60 * 1000,
    retry: false,
  })

  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const [password, setPassword] = useState('')
  const [editing, setEditing] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [deletes, setDeletes] = useState<Set<string>>(new Set())
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  const rows = useMemo(() => q.data?.keys ?? [], [q.data])
  const dirty = Object.keys(drafts).length > 0 || deletes.size > 0

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/settings/secrets', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, updates: drafts, deletes: [...deletes] }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || String(res.status))
      return body as { changed: string[]; deleted: string[]; versionId?: string }
    },
    onSuccess: (r) => {
      toast.success(isHe ? `נשמר: ${r.changed.length} עודכנו, ${r.deleted.length} נמחקו` : `Saved: ${r.changed.length} changed, ${r.deleted.length} deleted`)
      setDrafts({}); setDeletes(new Set())
      qc.invalidateQueries({ queryKey: ['settings-secrets'] })
    },
    onError: (e: Error) => toast.error(e.message === 'wrong password' ? (isHe ? 'סיסמה שגויה' : 'Wrong password') : e.message),
  })

  const toggleReveal = (k: string) => setRevealed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const mask = (v: string) => (v ? '•'.repeat(Math.min(24, Math.max(8, v.length))) : '')
  const valueOf = (r: KeyRow) => (r.key in drafts ? drafts[r.key] : r.value)
  const discard = () => { setDrafts({}); setDeletes(new Set()) }
  const addKey = () => {
    const k = newKey.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) { toast.error(isHe ? 'שם מפתח לא תקין' : 'Invalid key name'); return }
    setDrafts((d) => ({ ...d, [k]: newValue }))
    setNewKey(''); setNewValue('')
  }
  const added = Object.keys(drafts).filter((k) => !rows.some((r) => r.key === k))

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Settings}
        title={isHe ? 'הגדרות' : 'Settings'}
        description={isHe
          ? 'תצורת האפליקציה ב-AWS Secrets Manager. צפייה פתוחה לכל מי שמחובר; שינוי דורש את סיסמת ההגדרות.'
          : 'The app configuration in AWS Secrets Manager. Anyone signed in can view; changing needs the settings password.'}
        actions={q.data && (
          <span className="font-mono text-xs text-muted-foreground" dir="ltr">
            {q.data.secretId} · {q.data.region}{q.data.createdDate ? ` · ${new Date(q.data.createdDate).toLocaleString()}` : ''}
          </span>
        )}
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          {editing ? (
            <>
              <Unlock className="h-4 w-4 text-amber-500" />
              <span className="text-sm">{isHe ? 'מצב עריכה' : 'Editing'}</span>
              <Input
                id="settings-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isHe ? 'סיסמת הגדרות' : 'settings password'}
                className="h-8 w-56 text-sm"
              />
              <Button type="button" size="sm" className="h-8" disabled={!dirty || !password || save.isPending} onClick={() => save.mutate()}>
                <Save className="me-1 h-3.5 w-3.5" />{isHe ? 'שמור' : 'Save'}
                {dirty && <Badge variant="secondary" className="ms-2">{Object.keys(drafts).length + deletes.size}</Badge>}
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8" disabled={!dirty} onClick={discard}>
                <RotateCcw className="me-1 h-3.5 w-3.5" />{isHe ? 'בטל שינויים' : 'Discard'}
              </Button>
              <Button type="button" size="sm" variant="ghost" className="ms-auto h-8" onClick={() => { discard(); setPassword(''); setEditing(false) }}>
                <Lock className="me-1 h-3.5 w-3.5" />{isHe ? 'סיום עריכה' : 'Done'}
              </Button>
            </>
          ) : (
            <>
              <Lock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {isHe ? 'לצפייה בלבד' : 'View only'}
                {q.data && !q.data.editable && (isHe ? ' · עריכה כבויה: SETTINGS_EDIT_PASSWORD לא מוגדר' : ' · editing is off: SETTINGS_EDIT_PASSWORD is not set')}
              </span>
              <Button type="button" size="sm" variant="outline" className="ms-auto h-8" disabled={!q.data?.editable} onClick={() => setEditing(true)}>
                <Unlock className="me-1 h-3.5 w-3.5" />{isHe ? 'ערוך' : 'Edit'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {q.isLoading && <div className="h-64 animate-pulse rounded-md bg-muted/40" />}
      {q.error && (
        <p className="text-sm text-destructive">{isHe ? 'לא ניתן לקרוא את התצורה: ' : 'Could not read the config: '}{(q.error as Error).message}</p>
      )}

      {q.data && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-start">{isHe ? 'מפתח' : 'Key'}</th>
                <th className="px-3 py-2 text-start">{isHe ? 'ערך' : 'Value'}</th>
                <th className="w-24 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const gone = deletes.has(r.key)
                const changed = r.key in drafts
                return (
                  <tr key={r.key} className={gone ? 'opacity-50 line-through' : changed ? 'bg-amber-50 dark:bg-amber-500/10' : ''}>
                    <td className="px-3 py-2 font-mono" dir="ltr">{r.key}</td>
                    <td className="px-3 py-2 font-mono" dir="ltr">
                      {editing && !gone ? (
                        <Input
                          id={`secret-${r.key}`}
                          type={revealed.has(r.key) ? 'text' : 'password'}
                          value={valueOf(r)}
                          onChange={(e) => setDrafts((d) => ({ ...d, [r.key]: e.target.value }))}
                          className="h-8 font-mono text-xs"
                        />
                      ) : (
                        <span className="break-all">{revealed.has(r.key) ? valueOf(r) : mask(valueOf(r))}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggleReveal(r.key)} title={isHe ? 'הצג/הסתר' : 'Show/hide'}>
                          {revealed.has(r.key) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                        {editing && (
                          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" title={gone ? (isHe ? 'שחזר' : 'Restore') : (isHe ? 'מחק' : 'Delete')}
                            onClick={() => setDeletes((s) => { const n = new Set(s); if (n.has(r.key)) n.delete(r.key); else n.add(r.key); return n })}>
                            {gone ? <RotateCcw className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5 text-destructive" />}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {added.map((k) => (
                <tr key={k} className="bg-emerald-50 dark:bg-emerald-500/10">
                  <td className="px-3 py-2 font-mono" dir="ltr">{k} <Badge variant="secondary" className="ms-1 text-[10px]">{isHe ? 'חדש' : 'new'}</Badge></td>
                  <td className="px-3 py-2 font-mono" dir="ltr">
                    <Input id={`secret-${k}`} value={drafts[k]} onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))} className="h-8 font-mono text-xs" />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end">
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDrafts((d) => { const n = { ...d }; delete n[k]; return n })}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {editing && (
                <tr>
                  <td className="px-3 py-2">
                    <Input id="settings-new-key" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="NEW_KEY" className="h-8 font-mono text-xs" dir="ltr" />
                  </td>
                  <td className="px-3 py-2">
                    <Input id="settings-new-value" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder={isHe ? 'ערך' : 'value'} className="h-8 font-mono text-xs" dir="ltr" />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end">
                      <Button type="button" size="sm" variant="outline" className="h-8" disabled={!newKey.trim()} onClick={addKey}>
                        <Plus className="me-1 h-3.5 w-3.5" />{isHe ? 'הוסף' : 'Add'}
                      </Button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {isHe
          ? 'שמירה יוצרת גרסה חדשה של הסוד; הגרסה הקודמת נשמרת ב-AWS תחת AWSPREVIOUS. שינויים נקלטים באפליקציה בקריאה הבאה של המפתח.'
          : 'Saving writes a new version of the secret; AWS keeps the previous one under AWSPREVIOUS. The app picks a change up on its next read of that key.'}
      </p>
    </div>
  )
}
