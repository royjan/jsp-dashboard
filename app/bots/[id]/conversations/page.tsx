'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, MessagesSquare, Search, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import { formatNumber } from '@/lib/constants'
import { useBot, useConversations, useHideConversations } from '@/lib/bots-admin'

const CHANNEL_HE: Record<string, string> = { ui: 'קונסולה', telegram: 'טלגרם', whatsapp: 'וואטסאפ' }
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
  const bot = useBot(id)
  const [q, setQ] = useState('')
  const [typed, setTyped] = useState('')
  const [channel, setChannel] = useState('')
  const [sender, setSender] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [size, setSize] = useState(25)
  const [page, setPage] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const filters = { q, channel, sender, status, from, to, offset: String(page * size), limit: String(size) }
  const { data, isLoading, isFetching, error } = useConversations(id, filters)
  const hide = useHideConversations(id)
  const pages = data ? Math.max(1, Math.ceil(data.total / size)) : 1
  const reset = (fn: () => void) => { fn(); setPage(0); setPicked(new Set()) }

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
      <Link href={`/bots/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowRight className="h-4 w-4 ltr:rotate-180" />{bot.data?.name ?? id}
      </Link>
      <PageHeader icon={MessagesSquare} title={tr('שיחות', 'Conversations')}
                  description={data ? tr(`${formatNumber(data.total)} שיחות`, `${formatNumber(data.total)} conversations`) : undefined} />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-3">
          <form className="relative min-w-56 flex-1" onSubmit={(e) => { e.preventDefault(); reset(() => setQ(typed.trim())) }}>
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="ps-9" value={typed} onChange={(e) => setTyped(e.target.value)} onBlur={() => typed.trim() !== q && reset(() => setQ(typed.trim()))}
                   placeholder={tr('חיפוש בשאלה ובתשובה (Enter)', 'Search question and answer (Enter)')} />
          </form>
          <select className={select} value={channel} onChange={(e) => reset(() => setChannel(e.target.value))}>
            <option value="">{tr('כל הערוצים', 'All channels')}</option>
            {data?.channels.map((c) => <option key={c} value={c}>{he ? CHANNEL_HE[c] ?? c : c}</option>)}
          </select>
          <select className={`${select} max-w-56`} value={sender} onChange={(e) => reset(() => setSender(e.target.value))}>
            <option value="">{tr('כל השולחים', 'All senders')}</option>
            {data?.senders.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className={select} value={status} onChange={(e) => reset(() => setStatus(e.target.value))}>
            <option value="">{tr('כל הסטטוסים', 'Any status')}</option>
            <option value="ok">{tr('נענו', 'Answered')}</option>
            <option value="error">{tr('שגיאה', 'Error')}</option>
          </select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">{tr('מ־', 'From')}
            <Input type="date" className="w-36" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">{tr('עד', 'To')}
            <Input type="date" className="w-36" value={to} onChange={(e) => reset(() => setTo(e.target.value))} />
          </label>
          {(q || channel || sender || status || from || to) && (
            <Button size="sm" variant="ghost" onClick={() => reset(() => { setQ(''); setTyped(''); setChannel(''); setSender(''); setStatus(''); setFrom(''); setTo('') })}>
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
          <select className={select} value={size} onChange={(e) => reset(() => setSize(Number(e.target.value)))}>
            {[25, 50, 100].map((n) => <option key={n} value={n}>{tr(`${n} בעמוד`, `${n} per page`)}</option>)}
          </select>
          <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronRight className="h-4 w-4 ltr:rotate-180" />
          </Button>
          <span className="tabular-nums text-muted-foreground">{tr(`עמוד ${page + 1} מתוך ${pages}`, `Page ${page + 1} of ${pages}`)}</span>
          <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
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
                  <th className="p-2 text-start">{tr('זמן', 'Time')}</th>
                  <th className="p-2 text-start">{tr('ערוץ / שולח', 'Channel / sender')}</th>
                  <th className="p-2 text-start">{tr('שאלה', 'Question')}</th>
                  <th className="p-2 text-start">{tr('תשובה', 'Answer')}</th>
                  <th className="p-2 text-start">{tr('שניות', 'Secs')}</th>
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
