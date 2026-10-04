'use client'

import { use, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, Trash2, ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import { formatNumber } from '@/lib/constants'
import { useConversations, useHideConversations } from '@/lib/bots-admin'
import { CHANNEL_HE } from '../_parts'

type Key = 'q' | 'channel' | 'sender' | 'status' | 'from' | 'to' | 'sort_by' | 'order' | 'page' | 'size'
const select = 'rounded-md border bg-background px-3 py-2 text-sm'

/**
 * Every conversation one bot had — search, filters, pages, and remove. "Remove" hides a conversation from this
 * page and from the statistics (bot-admin's hidden_turns.json); the bot's own log is never rewritten, because
 * the running bot appends to it.
 */
export default function ConversationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { locale } = useLocale()
  const he = locale === 'he'
  const tr = (h: string, e: string) => (he ? h : e)
  const sp = useSearchParams()
  const router = useRouter()
  // EVERY FILTER LIVES IN THE URL (owner, 2026-10-04: "/bots/byd/conversations?sort_by=time&q=פנס"): a view is
  // a link you can keep or send. Changing anything but the page goes back to page 1.
  const get = (k: Key) => sp.get(k) ?? ''
  const q = get('q'), channel = get('channel'), sender = get('sender'), status = get('status'), from = get('from'), to = get('to')
  const sortBy = get('sort_by') || 'time', order = get('order') || 'desc'
  const size = [25, 50, 100].includes(Number(get('size'))) ? Number(get('size')) : 25
  const page = Math.max(0, Number(get('page') || 1) - 1)
  const setParams = (patch: Partial<Record<Key, string>>, keepPage = false) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k) }
    if (!keepPage) next.delete('page')
    if (next.get('sort_by') === 'time') next.delete('sort_by')
    if (next.get('order') === 'desc') next.delete('order')
    if (next.get('size') === '25') next.delete('size')
    const qs = next.toString()
    router.replace(`/bots/${id}/conversations${qs ? `?${qs}` : ''}`, { scroll: false })
    setPicked(new Set())
  }
  const [typed, setTyped] = useState(q)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const filters = { q, channel, sender, status, from, to, sort_by: sortBy, order, offset: String(page * size), limit: String(size) }
  const { data, isLoading, isFetching, error } = useConversations(id, filters)
  const hide = useHideConversations(id)
  const pages = data ? Math.max(1, Math.ceil(data.total / size)) : 1
  const sortHead = (key: string, label: string) => (
    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground"
            onClick={() => setParams({ sort_by: key, order: sortBy === key && order === 'desc' ? 'asc' : 'desc' })}>
      {label}
      {sortBy !== key ? <ArrowUpDown className="h-3 w-3 opacity-50" /> : order === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
    </button>
  )

  const toggle = (k: string) => setPicked((prev) => {
    const n = new Set(prev)
    if (n.has(k)) n.delete(k)
    else n.add(k)
    return n
  })
  const allOnPage = !!data?.items.length && data.items.every((t) => picked.has(t.key))
  const remove = (keys: string[]) => {
    if (!keys.length) return
    if (!window.confirm(tr(`להסיר ${keys.length} שיחות מהדשבורד ומהסטטיסטיקה?`, `Remove ${keys.length} conversations from the dashboard and the stats?`))) return
    hide.mutate(keys, { onSuccess: () => setPicked(new Set()) })
  }

  return (
    <div className="space-y-4">
      {data && <p className="text-sm text-muted-foreground">{tr(`${formatNumber(data.total)} שיחות`, `${formatNumber(data.total)} conversations`)}</p>}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <form className="relative min-w-56 flex-1" onSubmit={(e) => { e.preventDefault(); setParams({ q: typed.trim() }) }}>
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="ps-9" value={typed} onChange={(e) => setTyped(e.target.value)} onBlur={() => typed.trim() !== q && setParams({ q: typed.trim() })}
                   placeholder={tr('חיפוש בשאלה ובתשובה (Enter)', 'Search question and answer (Enter)')} />
          </form>
          <select className={select} value={channel} onChange={(e) => setParams({ channel: e.target.value })}>
            <option value="">{tr('כל הערוצים', 'All channels')}</option>
            {data?.channels.map((c) => <option key={c} value={c}>{he ? CHANNEL_HE[c] ?? c : c}</option>)}
          </select>
          <select className={`${select} max-w-56`} value={sender} onChange={(e) => setParams({ sender: e.target.value })}>
            <option value="">{tr('כל השולחים', 'All senders')}</option>
            {data?.senders.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className={select} value={status} onChange={(e) => setParams({ status: e.target.value })}>
            <option value="">{tr('כל הסטטוסים', 'Any status')}</option>
            <option value="ok">{tr('נענו', 'Answered')}</option>
            <option value="error">{tr('שגיאה', 'Error')}</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">{tr('מ־', 'From')}
            <Input type="date" className="w-36" value={from} onChange={(e) => setParams({ from: e.target.value })} />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">{tr('עד', 'To')}
            <Input type="date" className="w-36" value={to} onChange={(e) => setParams({ to: e.target.value })} />
          </label>
          {(q || channel || sender || status || from || to) && (
            <Button size="sm" variant="ghost" onClick={() => { setTyped(''); setParams({ q: '', channel: '', sender: '', status: '', from: '', to: '' }) }}>
              {tr('נקה סינון', 'Clear filters')}
            </Button>
          )}
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={!picked.size || hide.isPending} onClick={() => remove([...picked])}>
            <Trash2 className="me-1 h-4 w-4" />{tr(`הסר נבחרות (${picked.size})`, `Remove selected (${picked.size})`)}
          </Button>
          {isFetching && <span className="text-xs text-muted-foreground">{tr('טוען…', 'Loading…')}</span>}
        </div>
        <div className="flex items-center gap-2 text-sm">
          <select className={select} value={size} onChange={(e) => setParams({ size: e.target.value })}>
            {[25, 50, 100].map((n) => <option key={n} value={n}>{tr(`${n} בעמוד`, `${n} per page`)}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setParams({ page: String(page) }, true)}>
            <ChevronRight className="h-4 w-4 ltr:rotate-180" />
          </Button>
          <span className="tabular-nums text-muted-foreground">{tr(`עמוד ${page + 1} מתוך ${pages}`, `Page ${page + 1} of ${pages}`)}</span>
          <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setParams({ page: String(page + 2) }, true)}>
            <ChevronLeft className="h-4 w-4 ltr:rotate-180" />
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {isLoading ? <Skeleton className="h-64" /> : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="w-8 p-2"><input type="checkbox" checked={allOnPage} aria-label={tr('בחר הכל', 'Select all')}
                    onChange={() => setPicked((prev) => {
                      const n = new Set(prev)
                      for (const t of data?.items ?? []) { if (allOnPage) n.delete(t.key); else n.add(t.key) }
                      return n
                    })} /></th>
                  <th className="p-2 text-start">{sortHead('time', tr('זמן', 'Time'))}</th>
                  <th className="p-2 text-start">{sortHead('sender', tr('ערוץ / שולח', 'Channel / sender'))}</th>
                  <th className="p-2 text-start">{tr('שאלה', 'Question')}</th>
                  <th className="p-2 text-start">{tr('תשובה', 'Answer')}</th>
                  <th className="p-2 text-start">{sortHead('duration', tr('שניות', 'Secs'))}</th>
                  <th className="w-8 p-2" />
                </tr>
              </thead>
              <tbody>
                {data?.items.map((t) => (
                  <tr key={t.key} className="border-t align-top">
                    <td className="p-2"><input type="checkbox" checked={picked.has(t.key)} onChange={() => toggle(t.key)} /></td>
                    <td className="whitespace-nowrap p-2 text-xs text-muted-foreground" dir="ltr">
                      {new Date(t.ts * 1000).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="p-2 text-xs">
                      {he ? CHANNEL_HE[t.channel] ?? t.channel : t.channel}{t.chat ? ` · ${t.chat}` : ''}
                      {t.sender && <div className="text-muted-foreground" dir="auto">{t.sender}</div>}
                    </td>
                    <td className="max-w-xs p-2">{t.question}</td>
                    <td className="max-w-xl p-2 text-xs text-muted-foreground">
                      {!t.ok && <Badge variant="destructive" className="me-1">{tr('שגיאה', 'Error')}</Badge>}
                      <button type="button" className="whitespace-pre-wrap text-start hover:text-foreground" onClick={() => setOpen(open === t.key ? null : t.key)}>
                        {open === t.key ? (t.answer || t.error) : (t.answer || t.error).split('\n').slice(0, 2).join('\n')}
                      </button>
                    </td>
                    <td className="p-2 tabular-nums">{t.elapsed_s ?? ''}</td>
                    <td className="p-2">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" title={tr('הסר', 'Remove')} onClick={() => remove([t.key])}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data && !data.items.length && <p className="p-6 text-center text-sm text-muted-foreground">{tr('אין שיחות שמתאימות', 'No matching conversations')}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
