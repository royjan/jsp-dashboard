'use client'

/**
 * Diego v3 (ADK) sessions browser — session list (one per car/VIN) + full turn-by-turn
 * trace: customer messages, per-node outputs (state deltas), schema diagrams, final answers.
 * Read-only over the diego_v3 schema via /api/diego/sessions.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, Car, ChevronRight, ExternalLink, RefreshCw, User, X } from 'lucide-react'
import { Panel } from '@/components/chat-admin/Panel'
import { CustomerLink } from '@/components/shared/CustomerLink'
import { ItemLink } from '@/components/shared/ItemLink'

const ADK_WEB = process.env.NEXT_PUBLIC_ADK_WEB_BASE ?? 'http://192.168.0.230:8000'

interface SessionSummary {
  userId: string
  sessionId: string
  updateTime: string
  events: number
  turns: number
  vehicle: string | null
  lastUserText: string | null
}

interface DiegoEvent {
  id: string
  author: string
  timestamp: string
  text: string
  toolEvents: string[]
  stateDelta: Record<string, unknown> | null
  nodePath: string | null
  outputFor: string[] | null
  images: string[]
}

const AUTHOR_STYLE: Record<string, string> = {
  user: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  Diego_Clone: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  extract_slots: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  search_parts: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  enrich_parts: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  format_v2: 'bg-green-500/15 text-green-300 border-green-500/30',
}

const URL_SPLIT = /(https?:\/\/\S+)/g
const IMG_LINE = /^https?:\/\/\S+\.(?:png|jpe?g|webp)\s*$/i
const ITEM_URL = /\/items\/([\w.%-]+)/

/** ADK user ids are zero-padded Finansit customer codes ("0000032722") — link them. */
function customerCode(uid: string): string | null {
  return /^\d+$/.test(uid) ? String(Number(uid)) : null
}

/** "32722" and "0000032722" are the same ADK user; non-numeric ids match exactly. */
function sameUser(a: string, b: string): boolean {
  if (a === b) return true
  return /^\d+$/.test(a) && /^\d+$/.test(b) && Number(a) === Number(b)
}

/** URL user segment -> the id ADK stores (numeric codes are zero-padded to 10). */
function normalizeUser(u: string): string {
  return /^\d+$/.test(u) ? u.padStart(10, '0') : u
}

function tryPrettyJson(text: string): string | null {
  const t = text.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return null
  try {
    return JSON.stringify(JSON.parse(t), null, 2)
  } catch {
    return null
  }
}

const FLOW_ID = /(#[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g

/** One line of bot/customer text: natural direction per line, URLs become real links —
 *  item codes get the customers-page hover card (ItemLink), the 🧭 flow line's #<uuid>
 *  links the exact flow_decisions_v2 row, other URLs get a shortened label. */
function LinkifiedLine({ line }: { line: string }) {
  const parts = line.split(URL_SPLIT)
  return (
    <div dir="auto" className="whitespace-pre-wrap break-words">
      {parts.map((p, i) => {
        if (/^https?:\/\//i.test(p)) {
          const item = p.match(ITEM_URL)
          if (item) {
            // part code with the live stock/price hover card (same as /customers/<code>)
            return <ItemLink key={i} code={decodeURIComponent(item[1])} showCode copyable={false} />
          }
          // flow-decision URL (diego-adk emits these since 97d843a) -> short "#4d5acaa1" link
          const flow = p.match(/\/chat\/flow-decisions\?q=([0-9a-f]{8})[0-9a-f-]{28}/i)
          if (flow) {
            return (
              <a
                key={i}
                href={p.slice(p.indexOf('/chat/'))}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
                title={p}
                className="inline-flex items-baseline gap-0.5 font-mono text-emerald-400 hover:underline"
              >
                #{flow[1]}
                <ExternalLink className="inline h-3 w-3 opacity-60" />
              </a>
            )
          }
          const label = p.replace(/^https?:\/\//i, '').slice(0, 44) + (p.length > 52 ? '…' : '')
          return (
            <a
              key={i}
              href={p}
              target="_blank"
              rel="noreferrer"
              dir="ltr"
              className="inline-flex items-baseline gap-0.5 font-mono text-blue-400 hover:underline"
            >
              {label}
              <ExternalLink className="inline h-3 w-3 opacity-60" />
            </a>
          )
        }
        if (!line.includes('החלטת זרימה')) return <span key={i}>{p}</span>
        // flow line: "#<uuid>" -> short link to the flow-decision editor
        return (
          <span key={i}>
            {p.split(FLOW_ID).map((s, j) =>
              /^#[0-9a-f-]{36}$/.test(s) ? (
                <a
                  key={j}
                  href={`/chat/flow-decisions/edit/${s.slice(1)}`}
                  target="_blank"
                  rel="noreferrer"
                  dir="ltr"
                  title={s}
                  className="inline-flex items-baseline gap-0.5 font-mono text-emerald-400 hover:underline"
                >
                  #{s.slice(1, 9)}
                  <ExternalLink className="inline h-3 w-3 opacity-60" />
                </a>
              ) : (
                <span key={j}>{s}</span>
              )
            )}
          </span>
        )
      })}
    </div>
  )
}

const FLOW_PREFIX = '🧭 החלטת זרימה:'

/** One breadcrumb chip: "HEADLIGHT - GLASS - LAMP [100]" -> label + score badge. */
function FlowSegment({ seg }: { seg: string }) {
  const m = seg.match(/^(.*?)\s*\[(\d+)\]$/)
  const label = m ? m[1] : seg
  const score = m ? m[2] : null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-200">
      {label}
      {score && (
        <span className="rounded bg-indigo-500/20 px-1 font-mono text-[10px] leading-4 text-indigo-300/80">{score}</span>
      )}
    </span>
  )
}

/** The 🧭 flow-decision line as a breadcrumb: chips joined by arrows, the rule id as a short
 *  link (new full-URL format and the older bare "#<uuid>" both), source tag ("PSA"/"מוצמד") at the end. */
function FlowDecisionLine({ line }: { line: string }) {
  let rest = line.trim().slice(FLOW_PREFIX.length).trim()
  let tag: string | null = null
  const tagM = rest.match(/\(([^()]+)\)\s*$/)
  if (tagM) {
    tag = tagM[1]
    rest = rest.slice(0, tagM.index).trim()
  }
  return (
    <div dir="ltr" className="flex flex-wrap items-center gap-1.5 py-0.5">
      <span title="החלטת זרימה">🧭</span>
      {rest.split(' | ').map((item, i) => {
        let path = item.trim()
        let ruleId: string | null = null
        const urlM = path.match(/https?:\/\/\S+\/chat\/flow-decisions\?q=([0-9a-f-]{36})/i)
        const idM = urlM ? null : path.match(/#([0-9a-f-]{36})/i)
        if (urlM) {
          ruleId = urlM[1]
          path = path.replace(urlM[0], '').trim()
        } else if (idM) {
          ruleId = idM[1]
          path = path.replace(idM[0], '').trim()
        }
        const segs = path.split('→').map((s) => s.trim()).filter(Boolean)
        return (
          <span key={i} className="inline-flex flex-wrap items-center gap-1.5">
            {i > 0 && <span className="text-gray-600">|</span>}
            {segs.map((s, j) => (
              <span key={j} className="inline-flex items-center gap-1.5">
                {j > 0 && <ChevronRight className="h-3.5 w-3.5 text-gray-500" />}
                <FlowSegment seg={s} />
              </span>
            ))}
            {ruleId && (
              <a
                href={`/chat/flow-decisions?q=${ruleId}`}
                target="_blank"
                rel="noreferrer"
                title={ruleId}
                className="inline-flex items-baseline gap-0.5 font-mono text-xs text-emerald-400 hover:underline"
              >
                #{ruleId.slice(0, 8)}
                <ExternalLink className="inline h-3 w-3 opacity-60" />
              </a>
            )}
          </span>
        )
      })}
      {tag && (
        <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-300">
          {tag}
        </span>
      )}
    </div>
  )
}

/** Event body: pretty-print pure-JSON content (extract_slots), otherwise line-by-line with
 *  links; bare image-URL lines are dropped (the diagram renders below anyway). */
function EventBody({ text }: { text: string }) {
  const pretty = tryPrettyJson(text)
  if (pretty) {
    return (
      <pre className="max-h-72 overflow-auto rounded bg-black/40 p-2 text-xs leading-5 text-amber-200/90">
        {pretty}
      </pre>
    )
  }
  const lines = text.split('\n').filter((l) => !IMG_LINE.test(l.trim()))
  return (
    <div className="space-y-0.5 text-sm text-gray-200">
      {lines.map((l, i) =>
        l.trim().startsWith(FLOW_PREFIX) ? <FlowDecisionLine key={i} line={l} /> : <LinkifiedLine key={i} line={l} />
      )}
    </div>
  )
}

function fmtTime(ts: string) {
  try {
    return new Date(ts + (ts.endsWith('Z') ? '' : 'Z')).toLocaleString('he-IL', {
      dateStyle: 'short',
      timeStyle: 'medium',
    })
  } catch {
    return ts
  }
}

export default function DiegoSessionsTab({ initialPath = [] }: { initialPath?: string[] }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  // /chat/diego/<user> filters the list; /chat/diego/<user>/<session> deep-links a trace
  const [userFilter, setUserFilter] = useState<string | null>(initialPath.length === 1 ? initialPath[0] : null)
  const [selected, setSelected] = useState<{ user: string; id: string } | null>(() =>
    initialPath.length >= 2 ? { user: normalizeUser(initialPath[0]), id: initialPath[1] } : null
  )
  const [detail, setDetail] = useState<{ key: string; events: DiegoEvent[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const pickSession = useCallback((user: string, id: string) => {
    setSelected({ user, id })
    // keep the URL shareable without a Next.js navigation (page state is all client-side)
    window.history.replaceState(null, '', `/chat/diego/${encodeURIComponent(user)}/${encodeURIComponent(id)}`)
  }, [])

  const loadList = useCallback(async () => {
    // no setState before the first await — `loading` starts true, refresh sets it in the handler
    try {
      const r = await fetch('/api/diego/sessions')
      const j = await r.json()
      if (!j.success) throw new Error(j.error)
      setSessions(j.sessions)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

  // detail-loading is DERIVED (selected ≠ loaded key), so the effect never sets state synchronously
  const selKey = selected ? `${selected.user}/${selected.id}` : null
  const loadingDetail = !!selKey && detail?.key !== selKey

  useEffect(() => {
    if (!selected) return
    let dead = false
    const key = `${selected.user}/${selected.id}`
    fetch(`/api/diego/sessions?user=${encodeURIComponent(selected.user)}&id=${encodeURIComponent(selected.id)}`)
      .then((r) => r.json())
      .then((j) => {
        if (dead) return
        if (j.success) setDetail({ key, events: j.session.events })
        else setError(j.error)
      })
      .catch((e) => {
        if (!dead) setError(String(e))
      })
    return () => {
      dead = true
    }
  }, [selected])

  const selectedSummary = useMemo(
    () => sessions.find((s) => s.userId === selected?.user && s.sessionId === selected?.id),
    [sessions, selected]
  )

  const visibleSessions = useMemo(
    () => (userFilter ? sessions.filter((s) => sameUser(userFilter, s.userId)) : sessions),
    [sessions, userFilter]
  )

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[420px_1fr]">
      {/* ---- session list ---- */}
      <Panel
        title={`Sessions (${visibleSessions.length}${userFilter ? ` / ${sessions.length}` : ''})`}
        subtitle="One session per car — id is the VIN, user is the customer code"
        icon={<Car className="h-4 w-4" />}
        action={
          <button
            onClick={() => {
              setLoading(true)
              void loadList()
            }}
            className="rounded-md border border-[var(--color-border-default)] p-1.5 text-gray-400 hover:text-white"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        }
      >
        {error && <div className="mb-2 rounded bg-red-500/10 p-2 text-xs text-red-400">{error}</div>}
        {userFilter && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs text-blue-300">
            <User className="h-3 w-3" />
            user: <span className="font-mono">{userFilter}</span>
            <button
              onClick={() => {
                setUserFilter(null)
                window.history.replaceState(null, '', '/chat/diego')
              }}
              className="ml-auto rounded p-0.5 hover:bg-blue-500/20 hover:text-white"
              title="Clear user filter"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="max-h-[75vh] space-y-2 overflow-y-auto pr-1">
          {visibleSessions.map((s) => {
            const active = selected?.user === s.userId && selected?.id === s.sessionId
            const cust = customerCode(s.userId)
            return (
              <div
                key={`${s.userId}/${s.sessionId}`}
                role="button"
                tabIndex={0}
                onClick={() => pickSession(s.userId, s.sessionId)}
                onKeyDown={(ev) => ev.key === 'Enter' && pickSession(s.userId, s.sessionId)}
                className={`w-full cursor-pointer rounded-lg border p-3 text-left transition-colors ${
                  active
                    ? 'border-blue-500/60 bg-blue-500/10'
                    : 'border-[var(--color-border-default)] bg-black/20 hover:border-gray-500'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm text-white">{s.sessionId}</span>
                  <span className="text-[11px] text-gray-500">{fmtTime(s.updateTime)}</span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                  <User className="h-3 w-3" />
                  {cust ? (
                    <span onClick={(ev) => ev.stopPropagation()}>
                      <CustomerLink code={cust} showCode className="font-mono text-xs" />
                    </span>
                  ) : (
                    <span className="font-mono">{s.userId}</span>
                  )}
                  <span>· {s.turns} turns</span>
                  <span>· {s.events} events</span>
                </div>
                {s.vehicle && <div className="mt-1 text-xs text-gray-300" dir="rtl">{s.vehicle}</div>}
                {s.lastUserText && (
                  <div className="mt-1 truncate text-xs text-gray-500" dir="auto">
                    {s.lastUserText}
                  </div>
                )}
              </div>
            )
          })}
          {!loading && visibleSessions.length === 0 && (
            <div className="p-4 text-center text-sm text-gray-500">
              {userFilter ? `No sessions for user ${userFilter}` : 'No sessions yet'}
            </div>
          )}
        </div>
      </Panel>

      {/* ---- timeline ---- */}
      <Panel
        title={selected ? `${selected.id}` : 'Conversation trace'}
        subtitle={
          selectedSummary?.vehicle ??
          (selected ? `user ${selected.user}` : 'Select a session to see the full turn-by-turn trace')
        }
        icon={<Bot className="h-4 w-4" />}
        action={
          selected ? (
            <div className="flex items-center gap-2">
              {customerCode(selected.user) && (
                <CustomerLink code={customerCode(selected.user)!} showCode className="font-mono text-xs" />
              )}
              <a
                href={`${ADK_WEB}/dev-ui/?app=diego_v3&userId=${encodeURIComponent(selected.user)}&session=${encodeURIComponent(selected.id)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 rounded-md border border-[var(--color-border-default)] px-2 py-1 text-xs text-gray-300 hover:text-white"
              >
                adk web <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ) : undefined
        }
      >
        {loadingDetail && <div className="p-6 text-center text-sm text-gray-500">Loading…</div>}
        {!loadingDetail && detail && (
          <div className="max-h-[75vh] space-y-3 overflow-y-auto pr-1">
            {detail.events.map((e, i) => (
              <div key={e.id || i} className="rounded-lg border border-[var(--color-border-default)] bg-black/20 p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                      AUTHOR_STYLE[e.author] ?? 'bg-gray-500/15 text-gray-300 border-gray-500/30'
                    }`}
                  >
                    {e.author}
                  </span>
                  {e.outputFor && (
                    <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[11px] text-green-400">
                      output
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-gray-500">{fmtTime(e.timestamp)}</span>
                </div>
                {e.text && <EventBody text={e.text} />}
                {(e.toolEvents ?? []).length > 0 && (
                  <div className="space-y-0.5">
                    {e.toolEvents.map((t, j) => (
                      <div key={j} dir="ltr" className="break-all font-mono text-xs text-purple-300/80">
                        {t}
                      </div>
                    ))}
                  </div>
                )}
                {e.images.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {e.images.map((u) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt="schema" className="h-32 rounded-md border border-gray-700 object-contain" />
                      </a>
                    ))}
                  </div>
                )}
                {e.stateDelta && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-gray-400">
                      State: {Object.keys(e.stateDelta).join(', ')}
                    </summary>
                    <pre className="mt-1 max-h-72 overflow-auto rounded bg-black/40 p-2 text-[11px] leading-4 text-gray-300">
                      {JSON.stringify(e.stateDelta, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
            {detail.events.length === 0 && (
              <div className="p-6 text-center text-sm text-gray-500">No events in this session</div>
            )}
          </div>
        )}
        {!loadingDetail && !detail && !selected && (
          <div className="p-10 text-center text-sm text-gray-500">← Pick a car session</div>
        )}
      </Panel>
    </div>
  )
}
