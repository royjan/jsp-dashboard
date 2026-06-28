'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, Clock, UserCircle, AlertTriangle, ArrowLeft, Lightbulb, RefreshCw } from 'lucide-react'

interface Playbook {
  summary: string
  steps: string[]
  links: { label: string; href: string }[]
  timeline: string
  owner: string
  risk: string
}

export function ActionPlaybook({
  action,
  impact,
  isHe,
  children,
}: {
  action: string
  impact: string
  isHe: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pb, setPb] = useState<Playbook | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  async function load(force = false) {
    if ((pb && !force) || loading) return
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/ai/action-playbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, impact, locale: isHe ? 'he' : 'en', force }),
      })
      if (!res.ok) throw new Error()
      const d = await res.json()
      setPb(d.playbook)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          load()
        }}
        className="text-start inline-flex items-start gap-1.5 hover:text-primary transition-colors group"
        title={isHe ? 'הסבר מה בדיוק לעשות' : 'Explain exactly what to do'}
      >
        <Lightbulb className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-500 opacity-60 group-hover:opacity-100" />
        <span className="underline decoration-dotted decoration-muted-foreground/40 underline-offset-4">
          {children}
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" dir={isHe ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle className="text-base flex items-start gap-2 text-start">
              <Lightbulb className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <span>{action}</span>
            </DialogTitle>
          </DialogHeader>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {isHe ? 'בונה תוכנית פעולה…' : 'Building action plan…'}
            </div>
          )}

          {error && !loading && (
            <div className="py-8 text-center space-y-3">
              <p className="text-sm text-destructive">
                {isHe ? 'לא ניתן ליצור תוכנית כרגע.' : 'Could not generate a plan right now.'}
              </p>
              <button
                onClick={() => load(true)}
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <RefreshCw className="h-4 w-4" />
                {isHe ? 'נסה שוב' : 'Retry'}
              </button>
            </div>
          )}

          {pb && !loading && (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">{pb.summary}</p>

              <div>
                <h3 className="font-semibold mb-2">{isHe ? 'שלבי ביצוע' : 'Steps'}</h3>
                <ol className="space-y-1.5">
                  {pb.steps.map((s, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                        {i + 1}
                      </span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {pb.links.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pb.links.map((l, i) => (
                    <Link
                      key={i}
                      href={l.href}
                      className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent transition-colors"
                    >
                      {l.label}
                      <ArrowLeft className={`h-3 w-3 ${isHe ? '' : 'rotate-180'}`} />
                    </Link>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t">
                <div className="flex items-center gap-2 pt-2 text-muted-foreground">
                  <Clock className="h-4 w-4 shrink-0" />
                  <span>{pb.timeline}</span>
                </div>
                <div className="flex items-center gap-2 pt-2 text-muted-foreground">
                  <UserCircle className="h-4 w-4 shrink-0" />
                  <span>{pb.owner}</span>
                </div>
                {pb.risk && (
                  <div className="flex items-start gap-2 sm:col-span-2 text-amber-600 dark:text-amber-500">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>{pb.risk}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
