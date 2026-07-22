'use client'

/**
 * Customer 👍/👎 feedback inbox — record_feedback / respond_feedback events from diego_v3.
 * Negative feedback is the purest "wrong answer" signal; every row deep-links to the exact
 * session trace so the find → diagnose → fix loop starts here.
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, GitBranch, Plus, Radar, RefreshCw, ThumbsUp } from 'lucide-react'
import { Panel } from '@/components/chat-admin/Panel'
import { EventBody } from '@/components/chat-admin/DiegoSessionsTab'
import { AdminPageHeader } from '@/components/chat-admin/shared'
import { CustomerLink } from '@/components/shared/CustomerLink'
import { fmtDateTime, relTime } from '@/lib/chat-admin/format'

const IMG_URL_RE = /https?:\/\/\S+\.(?:png|jpe?g|webp)/gi

interface FeedbackItem {
  userId: string
  sessionId: string
  timestamp: string
  text: string
  stateDelta: Record<string, unknown> | null
  answerText: string | null
  ruleId: string | null
  ruleInferred: boolean
  searchTerm: string | null
}

/** VIN-looking session ids pass as vin, 7-8 digit ones as license_plate (same as the trace). */
function vehicleParam(sessionId: string): string {
  return /^\d{7,8}$/.test(sessionId)
    ? `license_plate=${encodeURIComponent(sessionId)}`
    : `vin=${encodeURIComponent(sessionId)}`
}

function customerCode(uid: string): string | null {
  return /^\d+$/.test(uid) ? String(Number(uid)) : null
}

/** 👎-looking feedback bubbles to the top visually via the red accent. */
function isNegative(f: FeedbackItem): boolean {
  const s = `${f.text} ${JSON.stringify(f.stateDelta ?? {})}`
  return /👎|negative|thumbs_down|"rating"\s*:\s*(false|-1|0)|לא (טוב|נכון|מדויק)/i.test(s)
}

export default function FeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // no setState before the first await — `loading` starts true, refresh sets it in the handler
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/diego/feedback')
      const j = await r.json()
      if (j.success) { setItems(j.feedback); setError(null) }
      else setError(j.error)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    let dead = false
    void (async () => { if (!dead) await load() })()
    return () => { dead = true }
  }, [load])

  return (
    <div dir="ltr" className="chat-admin">
      <AdminPageHeader
        title="Bot Feedback"
        subtitle="Customer 👍/👎 on Diego answers — every row links to the exact conversation"
        icon={<ThumbsUp className="w-6 h-6" />}
      />
      <Panel
        title={`Feedback (${items?.length ?? 0})`}
        action={
          <button
            onClick={() => { setLoading(true); void load() }}
            className="rounded-md border border-[var(--color-border-default)] p-1.5 text-gray-400 hover:text-white"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        }
      >
        {error && <div className="mb-2 rounded bg-red-500/10 p-2 text-xs text-red-400">{error}</div>}
        {items && items.length === 0 && !loading && (
          <div className="p-10 text-center text-sm text-gray-500">
            אין עדיין משוב מלקוחות — ברגע שלקוח ישלח 👍/👎 על תשובה, הוא יופיע כאן.
          </div>
        )}
        <div className="space-y-2">
          {(items ?? []).map((f, i) => {
            const cust = customerCode(f.userId)
            const neg = isNegative(f)
            return (
              <div
                key={`${f.sessionId}-${f.timestamp}-${i}`}
                className={`rounded-lg border p-3 ${
                  neg ? 'border-red-500/30 bg-red-500/5' : 'border-[var(--color-border-default)] bg-black/20'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${
                    neg
                      ? 'border-red-500/30 bg-red-500/10 text-red-300'
                      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  }`}>
                    {neg ? '👎 שלילי' : '👍 משוב'}
                  </span>
                  {cust && <CustomerLink code={cust} showCode className="font-mono text-xs" />}
                  <span className="font-mono">{f.sessionId}</span>
                  <span className="ms-auto" title={fmtDateTime(f.timestamp)}>{relTime(f.timestamp)}</span>
                  {/* the rule behind the rated answer — one click into the editor to fix it;
                      when NO rule exists (pure PSA/catalog answer), offer create + trace instead */}
                  {f.ruleId ? (
                    <Link
                      href={`/chat/flow-decisions/edit/${f.ruleId}`}
                      className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 font-mono text-[11px] text-indigo-300 hover:bg-indigo-500/20"
                      title={
                        f.ruleInferred
                          ? `החלטת זרימה שזוהתה לפי המסלול בתשובה (${f.ruleId}) — ערוך`
                          : `ערוך את החלטת הזרימה שמאחורי התשובה (${f.ruleId})`
                      }
                    >
                      <GitBranch className="h-3 w-3" /> #{f.ruleId.slice(0, 8)}{f.ruleInferred ? ' ≈' : ''}
                    </Link>
                  ) : f.searchTerm ? (
                    <>
                      <Link
                        href={`/chat/flow-decisions?create=1&seed=${encodeURIComponent(f.searchTerm)}`}
                        className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[11px] text-indigo-300 hover:bg-indigo-500/20"
                        title={`אין חוק זרימה לתשובה הזו (מקור: קטלוג) — צור חוק חדש עבור "${f.searchTerm}"`}
                      >
                        <Plus className="h-3 w-3" /> צור חוק
                      </Link>
                      <Link
                        href={`/chat/flow-decisions/observatory?query=${encodeURIComponent(f.searchTerm)}&${vehicleParam(f.sessionId)}`}
                        className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[11px] text-sky-300 hover:bg-sky-500/20"
                        title="עקוב אחרי ההחלטה במצפה — למה נבחר המסלול הזה?"
                      >
                        <Radar className="h-3 w-3" /> Trace
                      </Link>
                    </>
                  ) : null}
                  <Link
                    href={`/chat/diego?u=${encodeURIComponent(f.userId)}&s=${encodeURIComponent(f.sessionId)}`}
                    className="inline-flex items-center gap-1 rounded-md border border-[var(--color-border-default)] px-2 py-1 text-[11px] text-gray-300 hover:bg-white/5 hover:text-white"
                  >
                    לשיחה <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
                {f.text && (
                  <div dir="auto" className="mt-2 text-sm text-gray-200">{f.text}</div>
                )}
                {f.answerText && (
                  <details className="mt-2" open>
                    <summary className="cursor-pointer text-[11px] text-gray-500">
                      התשובה שדורגה{f.ruleId ? ` · חוק #${f.ruleId.slice(0, 8)}` : ''}
                    </summary>
                    {/* same renderer as the conversation trace: flow breadcrumb chips,
                        part cards with ItemLinks, real links — not raw text */}
                    <div className="mt-1 max-h-96 overflow-auto rounded-lg border border-[var(--color-border-default)] bg-black/30 p-3">
                      <EventBody text={f.answerText} />
                      {(f.answerText.match(IMG_URL_RE) ?? []).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {[...new Set(f.answerText.match(IMG_URL_RE) ?? [])].map((u) => (
                            <a key={u} href={u} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={u} alt="schema" className="h-24 rounded-md border border-gray-700 object-contain" loading="lazy" />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                )}
                {f.stateDelta && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-[11px] text-gray-500">
                      State: {Object.keys(f.stateDelta).join(', ')}
                    </summary>
                    <pre className="mt-1 max-h-60 overflow-auto rounded bg-black/40 p-2 text-[11px] leading-4 text-gray-300">
                      {JSON.stringify(f.stateDelta, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}
