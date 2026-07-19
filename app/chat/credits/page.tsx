'use client'

/**
 * זיכויים והחזרות — Dora's supplier-credit case tracker, read live from the
 * Neon mirror of her brain DB (schema `dora`, trigger-synced in real time).
 */
import { useEffect, useMemo, useState } from 'react'
import { ReceiptText, RefreshCw, Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemLink } from '@/components/shared/ItemLink'
import { cn } from '@/lib/utils'

interface CreditCase {
  id: string
  external_ref: string | null
  title: string
  status: string | null
  owner: string | null
  notes: string | null
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
  follow_up_at: string | null
  closed_at: string | null
}

const MCP_STATUS_HE: Record<string, { label: string; cls: string }> = {
  returned_to_supplier: { label: 'הוחזר לספק', cls: 'bg-blue-500/10 text-blue-500 border-blue-500/30' },
  waiting_for_credit: { label: 'ממתין לזיכוי', cls: 'bg-amber-500/10 text-amber-500 border-amber-500/30' },
  credit_note_received: { label: 'התקבלה תעודת זיכוי', cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
  entered_in_finansit: { label: 'הוזן בפיננסית', cls: 'bg-teal-500/10 text-teal-600 border-teal-500/30' },
  cancelled: { label: 'מבוטל', cls: 'bg-gray-500/10 text-gray-500 border-gray-500/30' },
}

function statusBadge(c: CreditCase) {
  const mcp = c.metadata?.mcp_status as string | undefined
  if (mcp) {
    const m = MCP_STATUS_HE[mcp] ?? (mcp.startsWith('closed')
      ? { label: 'סגור', cls: 'bg-gray-500/10 text-gray-500 border-gray-500/30' }
      : { label: mcp, cls: 'bg-gray-500/10 text-gray-500 border-gray-500/30' })
    return <Badge variant="outline" className={cn('text-xs', m.cls)}>{m.label}</Badge>
  }
  const closed = !!c.closed_at || c.status === 'closed'
  return (
    <Badge variant="outline" className={cn('text-xs', closed
      ? 'bg-gray-500/10 text-gray-500 border-gray-500/30'
      : 'bg-amber-500/10 text-amber-500 border-amber-500/30')}>
      {closed ? 'סגור' : 'פתוח'}
    </Badge>
  )
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return s
  }
}

export default function CreditsPage() {
  const [cases, setCases] = useState<CreditCase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [openOnly, setOpenOnly] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/dora/credits')
      const j = await r.json()
      if (!j.success) throw new Error(j.error)
      setCases(j.cases)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  const visible = useMemo(() => {
    let list = cases
    if (openOnly) list = list.filter((c) => !c.closed_at && !(c.metadata?.mcp_status || '').startsWith('closed') && c.metadata?.mcp_status !== 'cancelled')
    const needle = q.trim().toLowerCase()
    if (needle) {
      list = list.filter((c) =>
        [c.external_ref, c.title, c.owner, c.notes, JSON.stringify(c.metadata || {})]
          .some((v) => (v || '').toLowerCase().includes(needle))
      )
    }
    return list
  }, [cases, q, openOnly])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <ReceiptText className="h-6 w-6 text-rose-500" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl font-bold">זיכויים והחזרות — דורה</h1>
          <p className="text-sm text-muted-foreground">
            מעקב תיקי זיכוי מול ספקים, בזמן אמת מהמוח של דורה
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="rounded-md border p-2 text-muted-foreground hover:text-foreground"
          title="רענון"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative min-w-[240px] flex-1 max-w-md">
          <Search className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="חיפוש: תיק / מק״ט / ספק / אחראי..."
            className="h-9 w-full rounded-md border border-input bg-background pr-8 pl-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
          פתוחים בלבד
        </label>
        <span className="text-xs text-muted-foreground">{visible.length} / {cases.length} תיקים</span>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : (
        <div className="grid gap-2">
          {visible.map((c) => {
            const md = c.metadata || {}
            const isOpen = expanded === c.id
            return (
              <Card
                key={c.id}
                className={cn('cursor-pointer transition-colors hover:bg-muted/40', isOpen && 'bg-muted/30')}
                onClick={() => setExpanded(isOpen ? null : c.id)}
              >
                <CardContent className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-primary" dir="ltr">{c.external_ref || '—'}</span>
                    {statusBadge(c)}
                    {md.part_number && (
                      <span className="text-xs" onClick={(ev) => ev.stopPropagation()}>
                        מק״ט: <ItemLink code={String(md.part_number)} showCode />
                      </span>
                    )}
                    {md.quantity != null && <span className="text-xs text-muted-foreground">כמות: {md.quantity}</span>}
                    <span className="ms-auto text-xs text-muted-foreground">{fmtDate(c.updated_at)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-medium">{md.supplier_name || c.title}</span>
                    {c.owner && <span className="text-xs text-muted-foreground">אחראי: {c.owner}</span>}
                    {c.follow_up_at && !c.closed_at && (
                      <span className="text-xs text-amber-600">מעקב: {fmtDate(c.follow_up_at)}</span>
                    )}
                  </div>
                  {isOpen && (
                    <div className="mt-2 space-y-1 border-t pt-2 text-sm">
                      {c.notes && <p className="whitespace-pre-wrap text-muted-foreground">{c.notes}</p>}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>נפתח: {fmtDate(md.opened_at || c.created_at)}</span>
                        <span>עודכן: {fmtDate(md.updated_at || c.updated_at)}</span>
                        {c.closed_at && <span>נסגר: {fmtDate(c.closed_at)}</span>}
                        {md.supplier_slug && <span dir="ltr">ספק: {md.supplier_slug}</span>}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
          {visible.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">אין תיקים תואמים</p>
          )}
        </div>
      )}
    </div>
  )
}
