'use client'

import { use } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bot, ArrowRight, Play, Square, RotateCw, ExternalLink } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/lib/locale-context'
import { formatNumber } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { useBot, useBotAction } from '@/lib/bots-admin'

/**
 * One bot: header, actions and the three tabs as ROUTES - /bots/<id>/overview, /conversations, /limit - so a link
 * opens a tab and a filtered conversation list is a URL (owner, 2026-10-04). Real links instead of Radix Tabs also
 * fixed the direction: Radix Tabs defaulted to dir=ltr and everything inside them (the table) ran left to right.
 */
export default function BotLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = use(params)
  const { locale, dir } = useLocale()
  const he = locale === 'he'
  const tr = (h: string, e: string) => (he ? h : e)
  const path = usePathname() || ''
  const bot = useBot(id)
  const action = useBotAction(id)
  const b = bot.data
  const tabs = [
    { href: `/bots/${id}/overview`, label: tr('סקירה', 'Overview') },
    { href: `/bots/${id}/conversations`, label: tr('שיחות', 'Conversations') },
    { href: `/bots/${id}/limit`, label: tr('הגדרות והגבלות', 'Settings & limits') },
  ]
  return (
    <div dir={dir} className="space-y-6">
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
      <nav className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href}
                className={cn('rounded-md px-3 py-1.5 text-sm transition-colors',
                  path.startsWith(t.href) ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            {t.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  )
}
