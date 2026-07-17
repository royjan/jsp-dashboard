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
}

export interface DiegoEvent {
  id: string
  author: string
  timestamp: string
  text: string
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
  return res.rows.map((r: Json) => ({
    userId: r.user_id,
    sessionId: r.id,
    createTime: r.create_time,
    updateTime: r.update_time,
    events: r.events,
    turns: r.turns,
    vehicle: describeVehicle(r.vehicle_ctx),
    lastUserText: r.last_user_text ?? null,
  }))
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

function mapEvent(d: Json, ts: string): DiegoEvent {
  const text: string = (d?.content?.parts ?? [])
    .map((p: Json) => p?.text ?? '')
    .filter(Boolean)
    .join('')
  const delta = d?.actions?.state_delta
  const images = new Set<string>(text.match(IMG_RE) ?? [])
  for (const u of (delta?.images as string[] | undefined) ?? []) images.add(u)
  return {
    id: d?.id ?? '',
    author: d?.author ?? '?',
    timestamp: ts,
    text,
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
