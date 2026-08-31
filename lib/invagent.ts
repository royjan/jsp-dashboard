/**
 * Invagent — the warehouse picking app (Flutter + Supabase). SERVER ONLY.
 *
 * Two things about this source decide the whole shape of this file:
 *
 * 1. It is not a stock, price or shelf source. Its `inventory` table mirrors
 *    the ERP's own `place` field from the same label files, one import behind.
 *    Everything on this dashboard that shows stock or a shelf reads FINAPI, and
 *    that must not change — a second, older answer beside the live one is worse
 *    than no second answer. What invagent knows that nothing else does is what a
 *    PERSON did: who picked a line, when, and what they could not find.
 *
 * 2. Every table is RLS-scoped to the logged-in warehouse user. Read with the
 *    anon key, PostgREST answers 200 and an empty array — so a browser fetch
 *    would render "nothing to pick" on a full floor, permanently and with no
 *    error. Hence the service_role key, hence server-only, and hence
 *    `InvagentUnavailable`: the caller must be able to tell "could not ask"
 *    from "asked, and there is nothing".
 */
import { fetchSecretValue } from '@/lib/aws-secrets'

const DEFAULT_URL = 'https://hxrytdimhxprnoqduilo.supabase.co'

/**
 * Two audiences, two strings.
 *
 * `message` is for the server log and names the actual cause — which env var,
 * which HTTP status. `userMessage` is what a person in the warehouse reads, and
 * "no INVAGENT_SUPABASE_SERVICE_KEY in env or the config secret" tells them
 * nothing they can act on while quietly publishing our configuration to anyone
 * who opens the page. Keeping the diagnostic OUT of the response is the point;
 * the fix has always been to read the log, not the screen.
 */
export class InvagentUnavailable extends Error {
  readonly userMessage: string
  constructor(reason: string, userMessage = 'אפליקציית הליקוט לא זמינה כרגע') {
    super(reason)
    this.name = 'InvagentUnavailable'
    this.userMessage = userMessage
  }
}

let cached: { url: string; key: string } | null = null

async function credentials() {
  if (cached) return cached
  const key =
    process.env.INVAGENT_SUPABASE_SERVICE_KEY ||
    (await fetchSecretValue('INVAGENT_SUPABASE_SERVICE_KEY').catch(() => ''))
  if (!key) {
    throw new InvagentUnavailable(
      'no INVAGENT_SUPABASE_SERVICE_KEY in env or the config secret — the anon key is not a ' +
        'substitute, RLS would hide every row and the page would render an empty floor',
      'אפליקציית הליקוט עדיין לא מחוברת',
    )
  }
  // Point 2 of the header is the whole reason this file exists, and until now
  // nothing enforced it: hand this function the anon key and every request
  // succeeds, every table answers `[]`, and /picking renders an idle floor on a
  // full warehouse — no error, nowhere, ever. Prove the key bypasses RLS before
  // using it, and decline exactly as if it were missing.
  if (!bypassesRls(key)) {
    throw new InvagentUnavailable(
      'INVAGENT_SUPABASE_SERVICE_KEY is set but is not a service_role key — RLS would hide ' +
        'every row and PostgREST answers 200 with [], so the floor would look idle',
      'אפליקציית הליקוט עדיין לא מחוברת',
    )
  }
  cached = { url: process.env.INVAGENT_SUPABASE_URL || DEFAULT_URL, key }
  return cached
}

/**
 * Does this key bypass RLS?
 *
 * Legacy keys are JWTs carrying `"role":"service_role"`. The keys Supabase
 * issues now are opaque — `sb_secret_…` bypasses RLS, `sb_publishable_…` is the
 * anon key renamed — so there is nothing to decode and the prefix is the whole
 * signal. Anything unrecognised fails closed; an unknown string is not proof.
 *
 * Kept in step with `finansit-sdk/src/invagent.ts`, which guards the same
 * source for the MCP tools.
 */
function bypassesRls(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true
  if (key.startsWith('sb_publishable_')) return false
  const body = key.split('.')[1]
  if (!body) return false
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { role?: string }
    return claims.role === 'service_role'
  } catch {
    return false
  }
}

async function query<T>(table: string, params: Record<string, string | number | undefined>): Promise<T[]> {
  const { url, key } = await credentials()
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))

  const res = await fetch(`${url}/rest/v1/${table}?${qs}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    // Picking state changes minute to minute; a cached floor is a wrong floor.
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new InvagentUnavailable(
      `GET ${table} → HTTP ${res.status}`,
      'אפליקציית הליקוט לא עונה כרגע',
    )
  }
  return (await res.json()) as T[]
}

export interface PickOrder {
  document_number: string
  status: string
  priority: string
  shipping_method: string | null
  created_at: string | null
}

export interface DisputeLine {
  sku: string
  description: string | null
  location: string | null
  unavailable_quantity: number | null
  unavailable_reason: string | null
  unavailable_at: string | null
  document_number: string
}

/**
 * Invagent names a document by gluing the ERP format onto the number:
 * `11128489` is format 11, document `128489` — which the ERP itself stores
 * zero-padded to six digits, so the tail is already in its canonical form and
 * needs no repadding. Confirmed against `dashboard.documents`, and across a
 * 1,000-order sample every `document_number` is 8 digits carrying a known
 * format prefix (11 חשבונית מס, 14 חשבונית עסקה, 19).
 *
 * Returns null rather than guessing at anything that does not match that shape:
 * a wrong format silently links to somebody else's document.
 */
export function splitDocumentNumber(documentNumber: string): { format: string; number: string } | null {
  if (!/^\d{8}$/.test(documentNumber)) return null
  return { format: documentNumber.slice(0, 2), number: documentNumber.slice(2) }
}

/** How many outstanding orders the queue asks for. Exported so the caller can say when it capped. */
export const PICK_QUEUE_LIMIT = 50

/** Orders still on the floor. Excludes shipped — the queue is work outstanding. */
export async function pickQueue(limit = PICK_QUEUE_LIMIT): Promise<PickOrder[]> {
  return query<PickOrder>('pick_orders', {
    select: 'document_number,status,priority,shipping_method,created_at',
    status: 'neq.shipped',
    order: 'priority.asc,created_at.asc',
    limit,
  })
}

/**
 * Lines a picker marked unavailable, grouped by part.
 *
 * A part short more than once is the actionable row: one shortage is a bad
 * minute, a repeat is a shelf whose count is wrong. Sorted so those come first
 * rather than leaving a reader to spot them in a flat list.
 */
export async function stockDisputes(since?: string, limit = 200) {
  const rows = await query<DisputeLine>('label_lines', {
    select: 'sku,description,location,unavailable_quantity,unavailable_reason,unavailable_at,document_number',
    unavailable_quantity: 'gt.0',
    unavailable_at: since ? `gte.${since}` : undefined,
    order: 'unavailable_at.desc',
    limit,
  })

  const byS = new Map<string, {
    sku: string; description: string; times: number; quantityShort: number
    lastAt: string | null; reasons: string[]; labelLocation: string | null
  }>()
  for (const r of rows) {
    const g = byS.get(r.sku) ?? {
      sku: r.sku, description: r.description || '', times: 0, quantityShort: 0,
      lastAt: null, reasons: [], labelLocation: r.location,
    }
    g.times += 1
    g.quantityShort += r.unavailable_quantity ?? 0
    g.lastAt = g.lastAt || r.unavailable_at
    if (r.unavailable_reason && !g.reasons.includes(r.unavailable_reason)) g.reasons.push(r.unavailable_reason)
    byS.set(r.sku, g)
  }

  return {
    lines: rows.length,
    bySku: [...byS.values()].sort((a, b) => b.times - a.times || b.quantityShort - a.quantityShort),
  }
}

export interface ShippedOrder {
  document_number: string
  customer_name: string | null
  shipping_method: string | null
  items_count: number
  total_quantity: number
  pick_duration_seconds: number | null
  shipped_at: string
}

/** Throughput: what shipped, and how long each took to pick. */
export async function shippingHistory(dateFrom?: string, dateTo?: string, limit = 200) {
  const rows = await query<ShippedOrder>('shipping_history', {
    select: 'document_number,customer_name,shipping_method,items_count,total_quantity,pick_duration_seconds,shipped_at',
    ...(dateFrom ? { shipped_at: `gte.${dateFrom}` } : {}),
    order: 'shipped_at.desc',
    limit,
  })
  // Upper bound applied here rather than on the wire: PostgREST needs a repeated
  // parameter for a second operator on one column, which the single-value map
  // above cannot express, and the row cap already bounds the response.
  const bounded = dateTo ? rows.filter((r) => r.shipped_at <= `${dateTo}T23:59:59Z`) : rows

  const timed = bounded.filter((r) => (r.pick_duration_seconds ?? 0) > 0)
  return {
    orders: bounded,
    // The denominator travels with the average, always. A mean over 3 of 90
    // orders is not the day's average and the bare number cannot say so.
    timedOrders: timed.length,
    avgPickSeconds: timed.length
      ? Math.round(timed.reduce((n, r) => n + (r.pick_duration_seconds ?? 0), 0) / timed.length)
      : null,
  }
}
