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

export class InvagentUnavailable extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'InvagentUnavailable'
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
    )
  }
  cached = { url: process.env.INVAGENT_SUPABASE_URL || DEFAULT_URL, key }
  return cached
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
  if (!res.ok) throw new InvagentUnavailable(`GET ${table} → HTTP ${res.status}`)
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

/** Orders still on the floor. Excludes shipped — the queue is work outstanding. */
export async function pickQueue(limit = 100): Promise<PickOrder[]> {
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
