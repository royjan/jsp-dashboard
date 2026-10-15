'use client'

import { use } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import { useBotHistory, type BotHistoryItem } from '@/lib/bots-admin'

/**
 * /bots/<id>/history - every change to this bot's settings, newest first (owner 2026-10-15: "use db").
 *
 * The rows are bots.history in the fleet DB, written by a trigger on bots.policy / bots.bot, so a change made any
 * way (this dashboard, a script, SQL) is listed; brands and Telegram (env file) are recorded by bot-admin itself.
 */
const KIND: Record<BotHistoryItem['kind'], [string, string]> = {
  policy: ['הגדרות והגבלות', 'Settings & limits'],
  bot: ['רישום הבוט', 'Registry'],
  env: ['מותגים / טלגרם', 'Brands / Telegram'],
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}

export default function HistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { locale } = useLocale()
  const he = locale === 'he'
  const tr = (h: string, e: string) => (he ? h : e)
  const { data, isLoading, error } = useBotHistory(id)
  if (isLoading) return <Skeleton className="h-64" />
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>
  if (!data?.available) return <p className="text-sm text-muted-foreground">{tr('היסטוריה לא זמינה (אין חיבור למסד הנתונים).', 'History is not available (no database).')}</p>
  if (!data.items.length) return <p className="text-sm text-muted-foreground">{tr('אין שינויים עדיין.', 'No changes yet.')}</p>
  return (
    <div className="space-y-2">
      {data.items.map((it) => (
        <Card key={it.id}>
          <CardContent className="space-y-1.5 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium tabular-nums">{new Date(it.at.replace(' ', 'T')).toLocaleString(he ? 'he-IL' : 'en-GB')}</span>
              <Badge variant="outline">{tr(...KIND[it.kind])}</Badge>
              <span className="text-muted-foreground" dir="ltr">{it.by || tr('לא ידוע', 'unknown')}</span>
              {it.created && <span className="text-xs text-muted-foreground">{tr('יצירה ראשונה', 'first record')}</span>}
            </div>
            {it.changes.length > 0 && !it.created && (
              <ul className="space-y-0.5">
                {it.changes.map((c) => (
                  <li key={c.key} className="break-words">
                    <span className="font-mono text-xs" dir="ltr">{c.key}</span>{': '}
                    <span className="text-muted-foreground line-through decoration-1">{show(c.old)}</span>
                    {he ? ' ← ' : ' → '}
                    <span>{show(c.new)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
