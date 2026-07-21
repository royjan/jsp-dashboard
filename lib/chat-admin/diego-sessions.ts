/**
 * Diego v3 (ADK) session/trace reader — the diego_v3 schema in the shared Neon DB.
 *
 * ADK's DatabaseSessionService owns these tables (sessions, events); we only READ.
 * Session id = the car's VIN; user_id = the Finansit customer code (or test_user).
 * events.event_data is the full ADK event JSON (snake_case): author, content.parts[].text,
 * actions.state_delta (per-node outputs: search / enriched / images / flows / reply),
 * node_info (path, output_for).
 */
import { query } from '@/lib/db'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any // ADK event JSON — deeply dynamic, typed at the edges

export interface DiegoSessionSummary {
  userId: string
  sessionId: string
  createTime: string
  updateTime: string
  events: number
  turns: number
  vehicle: string | null // "פיג'ו צרפת 3008 2021" from state.search.vehicle_ctx
  lastUserText: string | null
  customerName: string | null // from synced documents; null for non-customer ids (test_user, wa-*)
  doraEvents: number // turns routed to Dora (dora_flow author)
  stockEvents: number // turns routed to the stock pipeline
  errEvents: number // events whose state_delta carries a truthy *error key
  /** last user message arrived after the last bot answer, and the session has been
   *  quiet ≥3 min — the customer was likely left hanging */
  unanswered: boolean
}

export interface ListDiegoSessionsOptions {
  limit?: number
  offset?: number
  /** free-text search: session id (VIN), user id, vehicle ctx, or any user-message text */
  q?: string
  /** only sessions updated in the last N days */
  days?: number
}

export interface DiegoEvent {
  id: string
  author: string
  timestamp: string
  text: string
  /** function_call / function_response parts, one compact line each (e.g. "→ transfer_to_agent(agent_name=stock_flow)") */
  toolEvents: string[]
  stateDelta: Record<string, unknown> | null
  nodePath: string | null
  outputFor: string[] | null
  images: string[]
  /** the untrimmed ADK event JSON — the "raw" escape hatch that replaces adk web */
  raw: unknown
}

export interface DiegoSessionDetail {
  userId: string
  sessionId: string
  createTime: string
  updateTime: string
  state: Record<string, unknown>
  events: DiegoEvent[]
}

export async function listDiegoSessions(
  opts: ListDiegoSessionsOptions = {}
): Promise<{ sessions: DiegoSessionSummary[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000)
  const offset = Math.max(opts.offset ?? 0, 0)
  const q = opts.q?.trim() || null
  const days = opts.days && opts.days > 0 ? opts.days : null
  const res = await query(
    `SELECT s.user_id, s.id, s.create_time, s.update_time,
            s.state #> '{search,vehicle_ctx}'                        AS vehicle_ctx,
            count(e.id)::int                                         AS events,
            count(e.id) FILTER (WHERE e.event_data->>'author'='user')::int AS turns,
            count(e.id) FILTER (WHERE e.event_data->>'author'='dora_flow')::int AS dora_events,
            count(e.id) FILTER (WHERE e.event_data->>'author'='search_parts')::int AS stock_events,
            count(e.id) FILTER (WHERE
              (e.event_data#>>'{actions,state_delta,search,error}') IS NOT NULL
              OR EXISTS (
                SELECT 1 FROM jsonb_each_text(
                  CASE WHEN jsonb_typeof(e.event_data#>'{actions,state_delta}')='object'
                       THEN e.event_data#>'{actions,state_delta}' ELSE '{}'::jsonb END) kv
                WHERE kv.key LIKE '%error' AND kv.value IS NOT NULL AND kv.value NOT IN ('', 'null', 'false')
              ))::int                                                AS err_events,
            max(e.timestamp) FILTER (WHERE e.event_data->>'author'='user') AS last_user_ts,
            -- an "answer" is an output_for-stamped event, or (newer traces leave output_for
            -- null) a format_v2 / dora_flow event that actually said something
            max(e.timestamp) FILTER (WHERE
              (jsonb_typeof(e.event_data#>'{node_info,output_for}') NOT IN ('null') AND e.event_data#>'{node_info,output_for}' IS NOT NULL)
              OR (e.event_data->>'author' IN ('format_v2','dora_flow')
                  AND coalesce(e.event_data#>>'{content,parts,0,text}','') <> '')) AS last_answer_ts,
            (SELECT e2.event_data #>> '{content,parts,0,text}'
               FROM diego_v3.events e2
              WHERE e2.app_name=s.app_name AND e2.user_id=s.user_id AND e2.session_id=s.id
                AND e2.event_data->>'author'='user'
              ORDER BY e2.timestamp DESC LIMIT 1)                    AS last_user_text
     FROM diego_v3.sessions s
     LEFT JOIN diego_v3.events e
       ON e.app_name=s.app_name AND e.user_id=s.user_id AND e.session_id=s.id
     WHERE ($3::text IS NULL
            OR s.id ILIKE '%'||$3||'%'
            OR s.user_id ILIKE '%'||$3||'%'
            OR (s.state #>> '{search,vehicle_ctx}') ILIKE '%'||$3||'%'
            OR EXISTS (
                SELECT 1 FROM diego_v3.events eq
                WHERE eq.app_name=s.app_name AND eq.user_id=s.user_id AND eq.session_id=s.id
                  AND eq.event_data->>'author'='user'
                  AND eq.event_data#>>'{content,parts,0,text}' ILIKE '%'||$3||'%'))
       AND ($4::int IS NULL OR s.update_time > now() - ($4 || ' days')::interval)
     GROUP BY s.app_name, s.user_id, s.id, s.create_time, s.update_time, s.state
     ORDER BY s.update_time DESC
     LIMIT $1 OFFSET $2`,
    [limit + 1, offset, q, days]
  )
  const hasMore = res.rows.length > limit
  if (hasMore) res.rows.pop()
  const names = await customerNames(res.rows.map((r: Json) => r.user_id))
  const sessions = res.rows.map((r: Json) => {
    const lastUser = r.last_user_ts ? new Date(r.last_user_ts).getTime() : null
    const lastAnswer = r.last_answer_ts ? new Date(r.last_answer_ts).getTime() : null
    // "left hanging": last customer message got no answer AND the session has been quiet
    // ≥3 min (a fresher one is likely mid-pipeline, not stuck)
    const unanswered =
      lastUser != null &&
      (lastAnswer == null || lastAnswer < lastUser) &&
      Date.now() - lastUser > 3 * 60_000
    return {
      userId: r.user_id,
      sessionId: r.id,
      createTime: r.create_time,
      updateTime: r.update_time,
      events: r.events,
      turns: r.turns,
      vehicle: describeVehicle(r.vehicle_ctx),
      lastUserText: r.last_user_text ?? null,
      customerName: names.get(r.user_id) ?? null,
      doraEvents: r.dora_events ?? 0,
      stockEvents: r.stock_events ?? 0,
      errEvents: r.err_events ?? 0,
      unanswered,
    }
  })
  return { sessions, hasMore }
}

/** Customer display names: ADK user ids are zero-padded Finansit codes, exactly the
 *  customer_code format in dashboard.documents. Non-numeric ids (test_user, wa-*) skip this. */
async function customerNames(userIds: string[]): Promise<Map<string, string>> {
  const codes = [...new Set(userIds.filter((u) => /^\d+$/.test(u)))]
  if (!codes.length) return new Map()
  try {
    const nr = await query(
      `SELECT DISTINCT ON (customer_code) customer_code, customer_name
         FROM dashboard.documents
        WHERE customer_code = ANY($1) AND customer_name IS NOT NULL
        ORDER BY customer_code, doc_date DESC`,
      [codes]
    )
    return new Map(nr.rows.map((r: Json) => [r.customer_code, r.customer_name]))
  } catch (e) {
    console.warn('[diego-sessions] customer-name lookup failed:', e)
    return new Map()
  }
}

// ── Dora threads ─────────────────────────────────────────────────────────────
// Dora (credits/returns) is CUSTOMER-level business, not car-level — it only lives
// inside VIN sessions as an ingest artifact. These aggregate one thread per customer
// across all their sessions.

export interface DoraThreadSummary {
  userId: string
  customerName: string | null
  replies: number
  sessions: number
  lastTs: string
  lastText: string | null
}

export async function listDoraThreads(limit = 100): Promise<DoraThreadSummary[]> {
  const res = await query(
    `SELECT e.user_id,
            count(*) FILTER (WHERE e.event_data->>'author'='dora_flow'
                             AND coalesce(e.event_data#>>'{content,parts,0,text}','') <> '')::int AS replies,
            count(DISTINCT e.session_id)::int AS sessions,
            max(e.timestamp) FILTER (WHERE e.event_data->>'author'='dora_flow') AS last_ts,
            (SELECT e2.event_data #>> '{content,parts,0,text}'
               FROM diego_v3.events e2
              WHERE e2.user_id=e.user_id AND e2.event_data->>'author'='dora_flow'
                AND coalesce(e2.event_data#>>'{content,parts,0,text}','') <> ''
              ORDER BY e2.timestamp DESC LIMIT 1) AS last_text
       FROM diego_v3.events e
      GROUP BY e.user_id
     HAVING count(*) FILTER (WHERE e.event_data->>'author'='dora_flow') > 0
      ORDER BY max(e.timestamp) FILTER (WHERE e.event_data->>'author'='dora_flow') DESC
      LIMIT $1`,
    [limit]
  )
  const names = await customerNames(res.rows.map((r: Json) => r.user_id))
  return res.rows.map((r: Json) => ({
    userId: r.user_id,
    customerName: names.get(r.user_id) ?? null,
    replies: r.replies ?? 0,
    sessions: r.sessions ?? 0,
    lastTs: r.last_ts,
    lastText: r.last_text ?? null,
  }))
}

export interface DoraThreadEvent extends DiegoEvent {
  sessionId: string
}

/** The customer's full event stream across ALL sessions, time-ordered — the client
 *  groups turns and keeps only the Dora ones. sessionId tags each turn's origin. */
export async function getDoraThread(userId: string): Promise<DoraThreadEvent[]> {
  const res = await query(
    `SELECT event_data, timestamp, session_id FROM diego_v3.events
      WHERE user_id=$1 ORDER BY timestamp ASC LIMIT 2000`,
    [userId]
  )
  return res.rows.map((r: Json) => ({ ...mapEvent(r.event_data, r.timestamp), sessionId: r.session_id }))
}

/** Hard-delete a session and its events (events→sessions FK is ON DELETE CASCADE,
 *  but we delete events explicitly for clarity/back-compat). */
export async function deleteDiegoSession(userId: string, sessionId: string): Promise<number> {
  await query(`DELETE FROM diego_v3.events WHERE user_id=$1 AND session_id=$2`, [userId, sessionId])
  const res = await query(`DELETE FROM diego_v3.sessions WHERE user_id=$1 AND id=$2`, [userId, sessionId])
  return res.rowCount ?? 0
}

export async function getDiegoSession(userId: string, sessionId: string): Promise<DiegoSessionDetail | null> {
  const s = await query(
    `SELECT user_id, id, create_time, update_time, state
       FROM diego_v3.sessions WHERE user_id=$1 AND id=$2 LIMIT 1`,
    [userId, sessionId]
  )
  if (!s.rows.length) return null
  const ev = await query(
    `SELECT event_data, timestamp FROM diego_v3.events
      WHERE user_id=$1 AND session_id=$2 ORDER BY timestamp ASC LIMIT 500`,
    [userId, sessionId]
  )
  const row = s.rows[0]
  return {
    userId: row.user_id,
    sessionId: row.id,
    createTime: row.create_time,
    updateTime: row.update_time,
    state: row.state ?? {},
    events: ev.rows.map((r: Json) => mapEvent(r.event_data, r.timestamp)),
  }
}

const IMG_RE = /https?:\/\/\S+\.(?:png|jpe?g|webp)/gi

const TOOL_LINE_MAX = 140

function compactArgs(args: Json): string {
  const s = Object.entries(args ?? {})
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(', ')
  return s.length > TOOL_LINE_MAX ? s.slice(0, TOOL_LINE_MAX) + '…' : s
}

function mapEvent(d: Json, ts: string): DiegoEvent {
  const parts: Json[] = d?.content?.parts ?? []
  const text: string = parts
    .map((p: Json) => p?.text ?? '')
    .filter(Boolean)
    .join('')
  // Agent-routing / tool events have no text parts (they used to render as empty
  // bubbles) — surface them as compact call/response lines instead.
  const toolEvents: string[] = []
  for (const p of parts) {
    if (p?.function_call) {
      toolEvents.push(`→ ${p.function_call.name}(${compactArgs(p.function_call.args)})`)
    } else if (p?.function_response) {
      let resp = ''
      try {
        const s = JSON.stringify(p.function_response.response ?? null)
        if (s && s !== 'null' && s !== '{"result":null}') {
          resp = ' ' + (s.length > TOOL_LINE_MAX ? s.slice(0, TOOL_LINE_MAX) + '…' : s)
        }
      } catch { /* unserializable response — name alone is enough */ }
      toolEvents.push(`↩ ${p.function_response.name}${resp}`)
    }
  }
  const delta = d?.actions?.state_delta
  const images = new Set<string>(text.match(IMG_RE) ?? [])
  for (const u of (delta?.images as string[] | undefined) ?? []) images.add(u)
  return {
    id: d?.id ?? '',
    author: d?.author ?? '?',
    timestamp: ts,
    text,
    toolEvents,
    stateDelta: delta && Object.keys(delta).length ? delta : null,
    nodePath: d?.node_info?.path || null,
    outputFor: d?.node_info?.output_for ?? null,
    images: [...images],
    raw: d ?? null,
  }
}

export interface DiegoHealthSignals {
  lastEventAgeMin: number | null
  events24h: number
  turns24h: number
  errEvents24h: number
  /** avg seconds from a user message to the answer that followed it (last 24h) */
  avgAnswerSec: number | null
}

/** Derived "is Diego alive?" signals straight from diego_v3 — no host access needed. */
export async function diegoHealthSignals(): Promise<DiegoHealthSignals> {
  const res = await query(
    `WITH recent AS (
       SELECT timestamp, event_data FROM diego_v3.events
        WHERE timestamp > now() - interval '24 hours'
     ),
     answers AS (
       SELECT u.timestamp AS asked,
              (SELECT min(a.timestamp) FROM recent a
                WHERE a.timestamp > u.timestamp
                  AND ((jsonb_typeof(a.event_data#>'{node_info,output_for}') NOT IN ('null')
                        AND a.event_data#>'{node_info,output_for}' IS NOT NULL)
                       OR (a.event_data->>'author' IN ('format_v2','dora_flow')
                           AND coalesce(a.event_data#>>'{content,parts,0,text}','') <> ''))) AS answered
         FROM recent u WHERE u.event_data->>'author'='user'
     )
     SELECT
       (SELECT extract(epoch FROM now() - max(timestamp)) / 60 FROM diego_v3.events)::float AS last_age_min,
       (SELECT count(*) FROM recent)::int AS events_24h,
       (SELECT count(*) FROM recent WHERE event_data->>'author'='user')::int AS turns_24h,
       (SELECT count(*) FROM recent WHERE
          (event_data#>>'{actions,state_delta,search,error}') IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM jsonb_each_text(
              CASE WHEN jsonb_typeof(event_data#>'{actions,state_delta}')='object'
                   THEN event_data#>'{actions,state_delta}' ELSE '{}'::jsonb END) kv
            WHERE kv.key LIKE '%error' AND kv.value IS NOT NULL AND kv.value NOT IN ('', 'null', 'false')))::int AS err_24h,
       (SELECT avg(extract(epoch FROM answered - asked)) FROM answers WHERE answered IS NOT NULL)::float AS avg_answer_sec`
  )
  const r = res.rows[0] ?? {}
  return {
    lastEventAgeMin: r.last_age_min != null ? Math.round(r.last_age_min) : null,
    events24h: r.events_24h ?? 0,
    turns24h: r.turns_24h ?? 0,
    errEvents24h: r.err_24h ?? 0,
    avgAnswerSec: r.avg_answer_sec != null ? Math.round(r.avg_answer_sec) : null,
  }
}

export interface DiegoFeedbackItem {
  userId: string
  sessionId: string
  timestamp: string
  text: string
  stateDelta: Record<string, unknown> | null
}

/** Customer 👍/👎 events (record_feedback author), newest first. */
export async function listDiegoFeedback(limit = 100): Promise<DiegoFeedbackItem[]> {
  const res = await query(
    `SELECT user_id, session_id, timestamp, event_data
       FROM diego_v3.events
      WHERE event_data->>'author' IN ('record_feedback','respond_feedback')
      ORDER BY timestamp DESC LIMIT $1`,
    [limit]
  )
  return res.rows.map((r: Json) => {
    const d = r.event_data ?? {}
    const parts: Json[] = d?.content?.parts ?? []
    return {
      userId: r.user_id,
      sessionId: r.session_id,
      timestamp: r.timestamp,
      text: parts.map((p: Json) => p?.text ?? '').filter(Boolean).join(''),
      stateDelta: d?.actions?.state_delta ?? null,
    }
  })
}

function describeVehicle(ctx: Json): string | null {
  if (!ctx || typeof ctx !== 'object') return null
  const parts = [ctx.make, ctx.model ?? ctx.tradeName, ctx.year, ctx.engineModel, ctx.fuelType]
    .filter(Boolean)
    .map(String)
  return parts.length ? parts.join(' ') : null
}
