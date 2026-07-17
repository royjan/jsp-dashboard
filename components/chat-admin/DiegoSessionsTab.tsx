'use client'

/**
 * Diego v3 (ADK) sessions browser — session list (one per car/VIN) + full turn-by-turn
 * trace: customer messages, per-node outputs (state deltas), schema diagrams, final answers.
 * Read-only over the diego_v3 schema via /api/diego/sessions.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, Car, ExternalLink, RefreshCw, User } from 'lucide-react'
import { Panel } from '@/components/chat-admin/Panel'

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

export default function DiegoSessionsTab() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [selected, setSelected] = useState<{ user: string; id: string } | null>(null)
  const [detail, setDetail] = useState<{ key: string; events: DiegoEvent[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[420px_1fr]">
      {/* ---- session list ---- */}
      <Panel
        title={`Sessions (${sessions.length})`}
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
        <div className="max-h-[75vh] space-y-2 overflow-y-auto pr-1">
          {sessions.map((s) => {
            const active = selected?.user === s.userId && selected?.id === s.sessionId
            return (
              <button
                key={`${s.userId}/${s.sessionId}`}
                onClick={() => setSelected({ user: s.userId, id: s.sessionId })}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
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
                  <span className="font-mono">{s.userId}</span>
                  <span>· {s.turns} turns</span>
                  <span>· {s.events} events</span>
                </div>
                {s.vehicle && <div className="mt-1 text-xs text-gray-300" dir="rtl">{s.vehicle}</div>}
                {s.lastUserText && (
                  <div className="mt-1 truncate text-xs text-gray-500" dir="auto">
                    {s.lastUserText}
                  </div>
                )}
              </button>
            )
          })}
          {!loading && sessions.length === 0 && (
            <div className="p-4 text-center text-sm text-gray-500">No sessions yet</div>
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
            <a
              href={`${ADK_WEB}/dev-ui/?app=diego_v3&userId=${encodeURIComponent(selected.user)}&session=${encodeURIComponent(selected.id)}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-md border border-[var(--color-border-default)] px-2 py-1 text-xs text-gray-300 hover:text-white"
            >
              adk web <ExternalLink className="h-3 w-3" />
            </a>
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
                {e.text && (
                  <div className="whitespace-pre-wrap break-words text-sm text-gray-200" dir="auto">
                    {e.text}
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
