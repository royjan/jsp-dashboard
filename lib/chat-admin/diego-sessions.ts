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
}

export interface DiegoSessionDetail {
  userId: string
  sessionId: string
  createTime: string
  updateTime: string
  state: Record<string, unknown>
  events: DiegoEvent[]
}

export async function listDiegoSessions(limit = 200): Promise<DiegoSessionSummary[]> {
  const res = await query(
    `SELECT s.user_id, s.id, s.create_time, s.update_time,
            s.state #> '{search,vehicle_ctx}'                        AS vehicle_ctx,
            count(e.id)::int                                         AS events,
            count(e.id) FILTER (WHERE e.event_data->>'author'='user')::int AS turns,
            count(e.id) FILTER (WHERE e.event_data->>'author'='dora_flow')::int AS dora_events,
            count(e.id) FILTER (WHERE e.event_data->>'author'='search_parts')::int AS stock_events,
            (SELECT e2.event_data #>> '{content,parts,0,text}'
               FROM diego_v3.events e2
              WHERE e2.app_name=s.app_name AND e2.user_id=s.user_id AND e2.session_id=s.id
                AND e2.event_data->>'author'='user'
              ORDER BY e2.timestamp DESC LIMIT 1)                    AS last_user_text
     FROM diego_v3.sessions s
     LEFT JOIN diego_v3.events e
       ON e.app_name=s.app_name AND e.user_id=s.user_id AND e.session_id=s.id
     GROUP BY s.app_name, s.user_id, s.id, s.create_time, s.update_time, s.state
     ORDER BY s.update_time DESC
     LIMIT $1`,
    [limit]
  )
  // Customer display names: ADK user ids are zero-padded Finansit codes, exactly the
  // customer_code format in dashboard.documents. Non-numeric ids (test_user, wa-*) skip this.
  const codes = [...new Set(res.rows.map((r: Json) => r.user_id).filter((u: string) => /^\d+$/.test(u)))]
  let names = new Map<string, string>()
  if (codes.length) {
    try {
      const nr = await query(
        `SELECT DISTINCT ON (customer_code) customer_code, customer_name
           FROM dashboard.documents
          WHERE customer_code = ANY($1) AND customer_name IS NOT NULL
          ORDER BY customer_code, doc_date DESC`,
        [codes]
      )
      names = new Map(nr.rows.map((r: Json) => [r.customer_code, r.customer_name]))
    } catch (e) {
      console.warn('[diego-sessions] customer-name lookup failed:', e)
    }
  }
  return res.rows.map((r: Json) => ({
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
  }))
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
  }
}

function describeVehicle(ctx: Json): string | null {
  if (!ctx || typeof ctx !== 'object') return null
  const parts = [ctx.make, ctx.model ?? ctx.tradeName, ctx.year, ctx.engineModel, ctx.fuelType]
    .filter(Boolean)
    .map(String)
  return parts.length ? parts.join(' ') : null
}
