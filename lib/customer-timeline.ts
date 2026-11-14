/**
 * Customer timeline ("ציר זמן") — the PURE half.
 *
 * Every source is turned into the same `TimelineEvent` shape here, then merged,
 * sorted and grouped by day. Nothing in this file touches a network, a database
 * or the DOM, so it is what `customer-timeline.test.ts` covers; the route
 * (`app/api/customers/[code]/timeline`) only fetches rows and hands them in.
 *
 * Titles are NOT built here. An event carries its kind, subtype and the raw
 * values (number, plate, asked text) and the tab composes the sentence through
 * `t()`, so the same cached payload reads in Hebrew and English.
 */

export type TimelineKind = 'request' | 'quote' | 'invoice' | 'delivery' | 'payment' | 'held'
export type TimelineSource = 'diego' | 'finapi' | 'deliveries' | 'held'

/** The filter row, in display order. `all` is not a kind. */
export const TIMELINE_FILTERS = ['all', 'request', 'quote', 'invoice', 'delivery', 'payment', 'held'] as const
export type TimelineFilter = (typeof TIMELINE_FILTERS)[number]

export interface TimelineEvent {
  /** Unique across sources — `${source}:${natural key}`. */
  id: string
  kind: TimelineKind
  /**
   * Finer type the title depends on: request → lookup | message | session;
   * invoice → the ERP format ('11', '12', '21', …); delivery → its status;
   * held → ordered | partial | arrived.
   */
  subtype?: string
  /** ISO timestamp, or a bare `YYYY-MM-DD` when the source only knows the day (ERP documents). */
  at: string
  /** False for day-only events: the tab shows no clock time for them. */
  hasTime: boolean
  /** Document / receipt / supplier order number. */
  number?: string
  /** Free text from the source (asked terms, chat text, item list). User content, shown verbatim. */
  text?: string
  plate?: string
  /** Who: WhatsApp chat name, staff user, driver, supplier. */
  who?: string
  /** Source status word (job state, request lane, delivery status, arrival status). */
  status?: string
  amount?: number
  href?: string
  external?: boolean
}

export interface TimelineDay {
  /** `YYYY-MM-DD`, Israel calendar day. */
  day: string
  events: TimelineEvent[]
}

export type SourceStatus = { ok: true; count: number } | { ok: false; error: string }

/** What GET /api/customers/{code}/timeline returns. */
export interface TimelinePayload {
  code: string
  events: TimelineEvent[]
  sources: Record<TimelineSource, SourceStatus>
  /** How many FINAPI requests building this payload made (0 = served from the history cache). */
  finapiCalls: number
  /** Set when the document list hit its cap: quotes/invoices before this day are not shown. */
  finapiSince?: string
  generatedAt: string
  cached?: boolean
}

// ── Day / ordering ───────────────────────────────────────────────────────────

const IL_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit',
})

/**
 * The Israel calendar day of an event. A bare date is already a day; a
 * timestamp is converted in Asia/Jerusalem, not UTC — a WhatsApp request at
 * 01:30 local is 23:30Z the day before, and bucketing on the UTC day would file
 * it under yesterday.
 */
export function dayKey(at: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at
  const d = new Date(at)
  if (isNaN(d.getTime())) return ''
  return IL_DAY.format(d)
}

/**
 * Newest first. Within a day, timed events come before day-only ones (an
 * invoice dated today has no clock time, so it cannot be placed between two
 * WhatsApp messages honestly); day-only events then order by number, highest
 * first, which for ERP documents is creation order.
 */
export function compareEvents(a: TimelineEvent, b: TimelineEvent): number {
  const da = dayKey(a.at)
  const db = dayKey(b.at)
  if (da !== db) return da < db ? 1 : -1
  if (a.hasTime !== b.hasTime) return a.hasTime ? -1 : 1
  if (a.hasTime) {
    const ta = Date.parse(a.at)
    const tb = Date.parse(b.at)
    if (ta !== tb) return tb - ta
  }
  const na = Number(a.number ?? NaN)
  const nb = Number(b.number ?? NaN)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return nb - na
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Merge per-source lists: drop undated events and duplicate ids, sort newest first. */
export function mergeTimeline(...lists: TimelineEvent[][]): TimelineEvent[] {
  const seen = new Set<string>()
  const out: TimelineEvent[] = []
  for (const list of lists) {
    for (const e of list) {
      if (!e.at || !dayKey(e.at) || seen.has(e.id)) continue
      seen.add(e.id)
      out.push(e)
    }
  }
  return out.sort(compareEvents)
}

export function filterTimeline(events: TimelineEvent[], filter: TimelineFilter): TimelineEvent[] {
  return filter === 'all' ? events : events.filter((e) => e.kind === filter)
}

/** Group an already-sorted list into days, preserving order. */
export function groupByDay(events: TimelineEvent[]): TimelineDay[] {
  const days: TimelineDay[] = []
  for (const e of events) {
    const day = dayKey(e.at)
    const last = days[days.length - 1]
    if (last && last.day === day) last.events.push(e)
    else days.push({ day, events: [e] })
  }
  return days
}

export function countByKind(events: TimelineEvent[]): Record<TimelineFilter, number> {
  const out = Object.fromEntries(TIMELINE_FILTERS.map((f) => [f, 0])) as Record<TimelineFilter, number>
  for (const e of events) out[e.kind] += 1
  out.all = events.length
  return out
}

// ── Codes ────────────────────────────────────────────────────────────────────

/** ERP / diego_web form: digits, zero-padded to 10. */
export function padCustomerCode(code: string): string {
  const s = String(code).trim()
  return /^\d+$/.test(s) ? s.padStart(10, '0') : s
}

/**
 * Every spelling another system may store this customer under. The delivery
 * app writes `31225` and `00099` (5-wide); invagent has been seen with
 * `031284`. Comparing as numbers would be simpler but cannot be pushed into a
 * Firestore `in` or a PostgREST `in.()` filter, so the variants are listed.
 */
export function customerCodeVariants(code: string): string[] {
  const s = String(code).trim()
  if (!/^\d+$/.test(s)) return [s]
  const bare = s.replace(/^0+/, '') || '0'
  const out = new Set<string>([bare])
  for (let w = bare.length; w <= 10; w++) out.add(bare.padStart(w, '0'))
  return [...out]
}

// ── Source normalisers ───────────────────────────────────────────────────────

const CHAT_BASE = 'https://chat.jan.parts'

export interface DiegoCar { id: number | string; plate: string | null; vin: string | null; label: string | null }
export interface DiegoJob {
  rid: string; car_id: number | string; term: string | null; state: string | null
  created_at: string; user_name: string | null
}
export interface DiegoIngress {
  rid: string; channel: string | null; chat_name: string | null; text: string | null
  car_id: number | string | null; created_at: string; status: string | null
}
export interface DiegoSession {
  id: number | string; car_id: number | string | null; channel: string | null; who: string | null
  started_at: string; last_at: string | null
}

/**
 * Link into diego-web. A real car opens by VIN; a "no car" conversation (a PN
 * list, stored with a synthetic `Q-<hex>` VIN) has no VIN page and opens by id.
 */
export function chatHref(car: DiegoCar | undefined): string | undefined {
  if (!car) return undefined
  const vin = (car.vin || '').trim()
  if (vin && !vin.startsWith('Q-')) return `${CHAT_BASE}/car/${encodeURIComponent(vin)}`
  return `${CHAT_BASE}/conversation/car=${encodeURIComponent(String(car.id))}`
}

function plateOf(car: DiegoCar | undefined): string | undefined {
  return car?.plate?.trim() || undefined
}

function clip(s: string | null | undefined, n = 160): string | undefined {
  const t = (s || '').replace(/\s+/g, ' ').trim()
  if (!t) return undefined
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/** Jobs of one lookup arrive as one row per term within seconds; they read as one request. */
const JOB_GROUP_GAP_MS = 5 * 60_000
/** A session is the conversation a message/lookup already shows; it only earns a row when nothing else does. */
const SESSION_SLACK_MS = 2 * 60_000

export function diegoEvents(input: {
  cars: DiegoCar[]
  jobs: DiegoJob[]
  ingress: DiegoIngress[]
  sessions: DiegoSession[]
}): TimelineEvent[] {
  const cars = new Map(input.cars.map((c) => [String(c.id), c]))
  const out: TimelineEvent[] = []

  // Lookups: chain a car's jobs while each is within 5 min of the previous.
  const jobs = [...input.jobs].sort((a, b) =>
    String(a.car_id) === String(b.car_id)
      ? Date.parse(a.created_at) - Date.parse(b.created_at)
      : String(a.car_id) < String(b.car_id) ? -1 : 1)
  let group: DiegoJob[] = []
  const flush = () => {
    if (!group.length) return
    const first = group[0]
    const last = group[group.length - 1]
    const car = cars.get(String(first.car_id))
    const terms = [...new Set(group.map((j) => (j.term || '').trim()).filter(Boolean))]
    const misses = group.filter((j) => j.state === 'miss').length
    out.push({
      id: `diego:job:${first.rid}`,
      kind: 'request',
      subtype: 'lookup',
      at: last.created_at,
      hasTime: true,
      text: clip(terms.join(' · ')),
      plate: plateOf(car),
      who: first.user_name || undefined,
      status: misses === group.length ? 'miss' : misses ? 'partial' : (last.state || undefined),
      href: chatHref(car),
      external: true,
    })
    group = []
  }
  for (const j of jobs) {
    const prev = group[group.length - 1]
    if (prev && (String(prev.car_id) !== String(j.car_id)
      || Date.parse(j.created_at) - Date.parse(prev.created_at) > JOB_GROUP_GAP_MS)) flush()
    group.push(j)
  }
  flush()

  for (const m of input.ingress) {
    const car = m.car_id != null ? cars.get(String(m.car_id)) : undefined
    out.push({
      id: `diego:in:${m.rid}`,
      kind: 'request',
      subtype: 'message',
      at: m.created_at,
      hasTime: true,
      text: clip(m.text),
      plate: plateOf(car),
      who: m.chat_name?.trim() || m.channel || undefined,
      status: m.status || undefined,
      href: chatHref(car),
      external: true,
    })
  }

  // Sessions overlap the rows above (diego-web opens one per WhatsApp request).
  // Keep one only when no lookup/message on the same car falls inside it.
  const anchors = out.map((e) => ({ car: e.href, t: Date.parse(e.at) }))
  for (const s of input.sessions) {
    const car = s.car_id != null ? cars.get(String(s.car_id)) : undefined
    const href = chatHref(car)
    const from = Date.parse(s.started_at) - SESSION_SLACK_MS
    const to = Date.parse(s.last_at || s.started_at) + SESSION_SLACK_MS
    if (href && anchors.some((a) => a.car === href && a.t >= from && a.t <= to)) continue
    out.push({
      id: `diego:session:${s.id}`,
      kind: 'request',
      subtype: 'session',
      at: s.started_at,
      hasTime: true,
      plate: plateOf(car),
      text: car?.label?.trim() || undefined,
      who: s.who?.trim() || s.channel || undefined,
      status: s.channel || undefined,
      href,
      external: !!href,
    })
  }
  return out
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function docDay(v: unknown): string {
  const s = String(v ?? '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return ''
}

/** FINAPI `/api/customers/{code}/documents` rows → quote (31) or invoice-ish events. */
/** A raw FINAPI row: shapes vary between endpoints and boxes, so fields are read defensively. */
type Row = Record<string, unknown>

export function documentEvents(docs: Row[]): TimelineEvent[] {
  const out: TimelineEvent[] = []
  for (const d of docs || []) {
    const format = String(d?.format ?? d?.doc_format ?? d?.type ?? '').trim()
    const number = String(d?.doc_number ?? d?.number ?? '').trim()
    const at = docDay(d?.doc_date ?? d?.date)
    if (!format || !number || !at) continue
    out.push({
      id: `finapi:doc:${format}:${number}`,
      kind: format === '31' ? 'quote' : 'invoice',
      subtype: format,
      at,
      hasTime: false,
      number,
      amount: num(d?.grand_total) ?? num(d?.total) ?? num(d?.amount),
      href: `/documents/${encodeURIComponent(format)}/${encodeURIComponent(number)}?year=${at.slice(0, 4)}`,
    })
  }
  return out
}

/** FINAPI receipts → payment events. No receipt page exists, so no link. */
export function receiptEvents(rows: Row[]): TimelineEvent[] {
  const out: TimelineEvent[] = []
  for (const r of rows || []) {
    const number = String(r?.order_num ?? r?.receipt_number ?? r?.doc_number ?? r?.number ?? '').trim()
    const at = docDay(r?.payment_date ?? r?.date ?? r?.doc_date)
    if (!at) continue
    out.push({
      id: `finapi:rcpt:${number || at}:${r?.amount ?? ''}`,
      kind: 'payment',
      at,
      hasTime: false,
      number: number || undefined,
      text: clip(r?.payment_method ? String(r.payment_method) : undefined),
      amount: num(r?.amount) ?? num(r?.paid) ?? num(r?.total),
    })
  }
  return out
}

export interface DeliveryRow {
  id: string
  documentNumber?: string | null
  status?: string | null
  driverName?: string | null
  notes?: string | null
  assignedAt?: string | null
  startedAt?: string | null
  deliveredAt?: string | null
  createdAt?: string | null
}

/** Delivery-app shipments → one event each, at the moment of its latest state. */
export function deliveryEvents(rows: DeliveryRow[]): TimelineEvent[] {
  const out: TimelineEvent[] = []
  for (const r of rows || []) {
    const at = r.deliveredAt || r.startedAt || r.assignedAt || r.createdAt
    if (!at) continue
    out.push({
      id: `deliveries:${r.id}`,
      kind: 'delivery',
      subtype: r.status || 'assigned',
      at,
      hasTime: true,
      number: r.documentNumber && r.documentNumber !== r.id ? String(r.documentNumber) : undefined,
      who: r.driverName || undefined,
      text: clip(r.notes, 100),
      href: `/deliveries/${encodeURIComponent(r.id)}`,
    })
  }
  return out
}

export interface HeldOrderRow {
  id?: string | number
  supplier?: string | null
  external_order_number?: string | null
  line_items?: { item_id?: string; description?: string; quantity?: number; qty_arrived?: number }[] | null
  arrival_status?: string | null
  created_at?: string | null
  arrived_at?: string | null
}

/**
 * Invagent special orders → "ordered" at created_at, plus an "arrived" event
 * when the row carries an arrival time. Arrival state is read from the lines
 * (qty_arrived vs quantity), falling back to `arrival_status`.
 */
export function heldEvents(rows: HeldOrderRow[]): TimelineEvent[] {
  const out: TimelineEvent[] = []
  for (const r of rows || []) {
    if (!r.created_at) continue
    const lines = Array.isArray(r.line_items) ? r.line_items : []
    const ordered = lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0)
    const arrived = lines.reduce((n, l) => n + Math.min(Number(l.qty_arrived) || 0, Number(l.quantity) || 0), 0)
    const st = (r.arrival_status || '').toLowerCase()
    const state = ordered > 0
      ? (arrived >= ordered ? 'arrived' : arrived > 0 ? 'partial' : 'ordered')
      : (/full|arriv|complete/.test(st) ? 'arrived' : /partial/.test(st) ? 'partial' : 'ordered')
    const items = clip(lines
      .map((l) => [l.description || l.item_id, (Number(l.quantity) || 0) > 1 ? `×${l.quantity}` : '']
        .filter(Boolean).join(' '))
      .filter(Boolean).join(' · '))
    const key = String(r.id ?? `${r.external_order_number}:${r.created_at}`)
    const base = {
      kind: 'held' as const,
      hasTime: true,
      number: r.external_order_number || undefined,
      who: r.supplier || undefined,
      text: items,
    }
    out.push({ ...base, id: `held:${key}`, subtype: 'ordered', status: state, at: r.created_at })
    if (state === 'arrived' && r.arrived_at) {
      out.push({ ...base, id: `held:${key}:arrived`, subtype: 'arrived', status: state, at: r.arrived_at })
    }
  }
  return out
}
