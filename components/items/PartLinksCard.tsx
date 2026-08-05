'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link2, Plus, X, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ItemLink } from '@/components/shared/ItemLink'
import { brandChipClasses } from '@/lib/brand'
import { toast } from '@/lib/toast'
import type { ItemLinkRow } from '@/hooks/use-analytics'

/**
 * "Cross-Brand Equivalents" card: lists partly.part_links aliases for the
 * item and lets the user add/remove MANUAL links (automatic schema-match
 * links are derived data and can't be removed here — they'd be re-created
 * by the next build run anyway).
 */
export function PartLinksCard({
  code,
  links,
  isHe,
}: {
  code: string
  links: ItemLinkRow[]
  isHe: boolean
}) {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [targetCode, setTargetCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['item-links', code] })

  const submit = async () => {
    const target = targetCode.trim().toUpperCase()
    if (!target || busy) return
    setBusy(true)
    setAddError(null)
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(code)}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetCode: target }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAddError(
          body?.error === 'target not in catalog'
            ? (isHe ? 'הקוד לא נמצא בקטלוג partly' : 'Code not found in the partly catalog')
            : body?.error === 'source not in catalog'
              ? (isHe ? 'הפריט הנוכחי לא קיים בקטלוג partly' : 'This item is not in the partly catalog')
              : body?.error || (isHe ? 'הקישור נכשל' : 'Linking failed')
        )
        return
      }
      toast.success(isHe ? `קושר ל-${target}` : `Linked to ${target}`)
      setTargetCode('')
      setAdding(false)
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (link: ItemLinkRow) => {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/items/${encodeURIComponent(code)}/links`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetCode: link.code }),
      })
      if (res.ok) {
        toast.success(isHe ? 'הקישור הוסר' : 'Link removed')
        refresh()
      } else {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error || (isHe ? 'ההסרה נכשלה' : 'Removal failed'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="h-4 w-4 text-cyan-500" />
          {isHe ? 'חלקים מקבילים בין יצרנים' : 'Cross-Brand Equivalents'}
          <button
            type="button"
            onClick={() => { setAdding((v) => !v); setAddError(null) }}
            className="ms-auto inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            title={isHe ? 'קשר חלק' : 'Link a part'}
          >
            {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {adding && (
          <div className="mb-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={targetCode}
                onChange={(e) => setTargetCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder={isHe ? 'קוד חלק (למשל 0816K8)' : 'Part code (e.g. 0816K8)'}
                dir="ltr"
                className="h-8 w-52 rounded-md border bg-background px-2 font-mono text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <button
                type="button"
                onClick={submit}
                disabled={busy || !targetCode.trim()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isHe ? 'קשר' : 'Link'}
              </button>
            </div>
            {addError && <p className="text-xs text-destructive">{addError}</p>}
          </div>
        )}

        {links.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {isHe
              ? 'אין חלקים מקושרים עדיין — לחץ + כדי לקשר חלק מקביל'
              : 'No linked parts yet — click + to link an equivalent part'}
          </p>
        ) : (
          <div className="space-y-2">
            {links.map((link) => (
              <div key={link.code} className="group flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${brandChipClasses(link.brand)}`}>
                  {link.brand}
                </span>
                {link.erpCode ? (
                  <ItemLink code={link.erpCode} showCode copyable={false} />
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="font-mono text-xs">{link.code}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {isHe ? 'קטלוג בלבד' : 'catalog only'}
                    </span>
                  </span>
                )}
                {link.description && (
                  <span className="text-muted-foreground text-xs" dir="ltr">{link.description}</span>
                )}
                {link.hebrewDescription && (
                  <span className="text-muted-foreground text-xs" dir="rtl">{link.hebrewDescription}</span>
                )}
                {link.confidence !== 'high' && (
                  <span
                    className="text-amber-500 font-bold cursor-help"
                    title={isHe ? 'התאמה משוערת' : 'Approximate match'}
                  >
                    ~
                  </span>
                )}
                {link.source === 'manual' && (
                  <button
                    type="button"
                    onClick={() => remove(link)}
                    className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    title={isHe ? 'הסר קישור ידני' : 'Remove manual link'}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
