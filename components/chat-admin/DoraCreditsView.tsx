'use client'

/**
 * זיכויים והחזרות — Dora's supplier-credit case tracker, read live from the
 * Neon mirror of her brain DB (schema `dora`, trigger-synced in real time).
 * Extracted from the old /chat/credits page so it can live as the Dora view's
 * main pane on /chat/diego (headerless — the host Panel provides the title).
 */
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemLink } from '@/components/shared/ItemLink'
import { cn } from '@/lib/utils'

// Read-only image server on the openclaw box (VM 102) — serves Dora's credit-note
// scans from /home/avi/.openclaw/credits-images (LAN/Tailscale only, like portal-pilot diagrams).
const IMG_BASE = process.env.NEXT_PUBLIC_CREDITS_IMG_BASE || 'http://192.168.0.161:8620'

interface CaseImage {
  kind: string
  rel_path: string
  caption: string
  added_at: string
  url: string
}

const IMG_KIND_HE: Record<string, string> = {
  credit_note: 'תעודת זיכוי',
  delivery_note: 'תעודת משלוח',
  part_photo: 'תמונת חלק',
  invoice: 'חשבונית',
  return: 'החזרה',
  receipt: 'קבלה',
  other: 'אחר',
}

function CaseImages({ caseRef }: { caseRef: string }) {
  const [images, setImages] = useState<CaseImage[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [viewerIdx, setViewerIdx] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    fetch(`${IMG_BASE}/cases/${encodeURIComponent(caseRef)}/images`, { signal: AbortSignal.timeout(8000) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => { if (alive) setImages(j.images || []) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [caseRef])

  if (failed) return <p className="text-xs text-muted-foreground">שרת התמונות לא זמין</p>
  if (images === null) return <Skeleton className="h-32 w-24" />
  if (images.length === 0) return null

  const count = images.length
  const viewer = viewerIdx !== null ? images[viewerIdx] : null
  // Thumbnails flow RTL (first image on the right), so the visually-left
  // neighbor is the NEXT index — the physical arrow keys follow the eye.
  const goLeft = () => setViewerIdx((i) => (i === null ? i : (i + 1) % count))
  const goRight = () => setViewerIdx((i) => (i === null ? i : (i - 1 + count) % count))

  return (
    <div className="flex flex-wrap gap-2">
      {images.map((img, i) => (
        <button
          key={img.rel_path}
          type="button"
          onClick={(ev) => { ev.stopPropagation(); setViewerIdx(i) }}
          className="group text-start"
          title={img.caption || img.rel_path}
        >
          <img
            src={`${IMG_BASE}${img.url}`}
            alt={img.caption || img.kind}
            className="h-32 rounded-md border object-contain transition-transform group-hover:scale-[1.03]"
            loading="lazy"
          />
          <span className="mt-0.5 block text-center text-[10px] text-muted-foreground">
            {IMG_KIND_HE[img.kind] || img.kind}
          </span>
        </button>
      ))}
      <Dialog open={viewer !== null} onOpenChange={(open) => { if (!open) setViewerIdx(null) }}>
        <DialogContent
          className="max-w-4xl p-2 sm:p-4"
          onClick={(ev) => ev.stopPropagation()}
          onKeyDown={(ev) => {
            if (ev.key === 'ArrowLeft') { ev.preventDefault(); goLeft() }
            if (ev.key === 'ArrowRight') { ev.preventDefault(); goRight() }
          }}
        >
          {viewer && (
            <div className="space-y-2">
              <DialogTitle className="text-sm font-medium pe-8">
                {IMG_KIND_HE[viewer.kind] || viewer.kind}
                {viewer.caption ? ` — ${viewer.caption}` : ''}
              </DialogTitle>
              <div className="relative">
                <img
                  src={`${IMG_BASE}${viewer.url}`}
                  alt={viewer.caption || viewer.kind}
                  className="max-h-[75vh] w-full rounded-md object-contain"
                />
                {count > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={goLeft}
                      aria-label="תמונה הבאה"
                      className="absolute left-1 top-1/2 -translate-y-1/2 rounded-full bg-background/80 border p-1.5 text-foreground hover:bg-background shadow"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={goRight}
                      aria-label="תמונה קודמת"
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-background/80 border p-1.5 text-foreground hover:bg-background shadow"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span dir="ltr">{viewer.rel_path}</span>
                {count > 1 && (
                  <span dir="ltr" className="tabular-nums">{(viewerIdx ?? 0) + 1} / {count}</span>
                )}
                <a
                  href={`${IMG_BASE}${viewer.url}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  פתיחה בכרטיסייה חדשה ↗
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface CreditCase {
  id: string
  external_ref: string | null
  title: string
  status: string | null
  owner: string | null
  notes: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any> | null
  created_at: string
  updated_at: string
  follow_up_at: string | null
  closed_at: string | null
  supplier_match: {
    code: string
    name: string
    score: number
    customer_code: string | null
    customer_name: string | null
  } | null
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

export default function DoraCreditsView() {
  const [cases, setCases] = useState<CreditCase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [openOnly, setOpenOnly] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  // The mirror refreshes once a day and used to fail silently — five weeks of stale cases were
  // shown as current with nothing indicating it. Never render this list without saying how old
  // it is when the daily run has been missed.
  const [staleHours, setStaleHours] = useState<number | null>(null)

  const load = async () => {
    try {
      const r = await fetch('/api/dora/credits')
      const j = await r.json()
      if (!j.success) throw new Error(j.error)
      setCases(j.cases)
      setStaleHours(j.mirror_stale ? (j.mirror_age_hours ?? null) : null)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    let dead = false
    void (async () => { if (!dead) await load() })()
    return () => { dead = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
    <div dir="rtl" className="space-y-3">
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
        <button
          onClick={() => { setLoading(true); void load() }}
          className="ms-auto rounded-md border p-2 text-muted-foreground hover:text-foreground"
          title="רענון"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {staleHours !== null && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          ⚠️ הנתונים כאן מסונכרנים אחת ליום, והסנכרון האחרון היה לפני{' '}
          {staleHours >= 48 ? `${Math.floor(staleHours / 24)} ימים` : `${Math.round(staleHours)} שעות`}.
          ייתכן שלדורה יש תיקים עדכניים יותר — שאלו אותה ישירות.
        </p>
      )}

      {loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : (
        <div className="grid max-h-[70vh] gap-2 overflow-y-auto pe-1">
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
                    {c.supplier_match ? (
                      // The customer twin card (3xxxx "לקוח") has the rich page;
                      // the 4xxxx supplier card page is empty for non-import suppliers.
                      <Link
                        href={c.supplier_match.customer_code
                          ? `/customers/${c.supplier_match.customer_code}`
                          : `/suppliers/${c.supplier_match.code}`}
                        onClick={(ev) => ev.stopPropagation()}
                        className="font-medium text-primary hover:underline"
                        title={c.supplier_match.customer_code
                          ? `כרטיס לקוח ${c.supplier_match.customer_code} · כרטיס ספק ${c.supplier_match.code} (התאמה ${Math.round(c.supplier_match.score * 100)}%)`
                          : `כרטיס ספק ${c.supplier_match.code} (התאמה ${Math.round(c.supplier_match.score * 100)}%)`}
                      >
                        {c.supplier_match.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{md.supplier_name || c.title}</span>
                    )}
                    {c.owner && <span className="text-xs text-muted-foreground">אחראי: {c.owner}</span>}
                    {c.follow_up_at && !c.closed_at && (
                      <span className="text-xs text-amber-600">מעקב: {fmtDate(c.follow_up_at)}</span>
                    )}
                  </div>
                  {isOpen && (
                    <div className="mt-2 space-y-2 border-t pt-2 text-sm">
                      {c.external_ref && <CaseImages caseRef={c.external_ref} />}
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
