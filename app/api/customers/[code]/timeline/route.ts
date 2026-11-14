export const maxDuration = 90

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { fetchCustomerDocumentsSlow, fetchCustomerReceiptsSlow } from '@/lib/finansit-client'
import { getCached, setCache } from '@/lib/redis-client'
import { getDeliveryFirestore, toIso } from '@/lib/firebase'
import { heldOrdersForCustomer } from '@/lib/invagent'
import {
  customerCodeVariants, deliveryEvents, diegoEvents, documentEvents, heldEvents, mergeTimeline,
  padCustomerCode, receiptEvents,
  type DeliveryRow, type DiegoCar, type DiegoIngress, type DiegoJob, type DiegoSession,
  type HeldOrderRow, type SourceStatus, type TimelineEvent, type TimelinePayload, type TimelineSource,
} from '@/lib/customer-timeline'

/**
 * GET /api/customers/{code}/timeline — one merged, newest-first list of what
 * happened with a customer, from four independent sources. READ-ONLY.
 *
 *  diego      Neon `diego_web` (cars/jobs/ingress/sessions)
 *  finapi     quotes, invoices, receipts — 2026 from FINAPI ONLY. Postgres
 *             `dashboard.documents` stops in May and must never stand in for
 *             the active year.
 *  deliveries delivery-app Firestore `shipments`, by customerId
 *  held       invagent `internal_orders`, not archived
 *
 * FINAPI is one ERP seat. The customer page already loads
 * `/api/customers/{code}/history` (documents + receipts + orders) and caches
 * it; this route reads that cache first and only calls FINAPI itself — twice,
 * documents and receipts, once each, no retry — when it is missing or partial.
 * The tab waits for the history request to settle before asking, so on a
 * normal page load the timeline costs FINAPI nothing.
 *
 * Each source fails on its own: the payload carries a per-source status, and a
 * failed source is reported, never rendered as "nothing happened".
 */

const CACHE_TTL = 10 * 60
/** A payload with a failed source is kept briefly so a reload can recover, not for 10 min. */
const PARTIAL_TTL = 2 * 60
const CACHE_VERSION = 'v1'
const DOC_LIMIT = 250
const RECEIPT_LIMIT = 250
const DELIVERY_LIMIT = 300


// Two tabs opening the same cold customer must not double the FINAPI calls.
const inflight = new Map<string, Promise<TimelinePayload>>()

async function diegoSource(padded: string): Promise<TimelineEvent[]> {
  // The customer's own cars, plus any car a session tagged with this customer
  // (needed for the session's plate/link even when the car is someone else's).
  const cars = (await query(
    `SELECT id, plate, vin, label, (customer_code = $1) AS own FROM diego_web.cars
      WHERE customer_code = $1
         OR id IN (SELECT car_id FROM diego_web.sessions
                    WHERE customer_code = $1 AND NOT COALESCE(hidden, false) AND car_id IS NOT NULL)`,
    [padded],
  )).rows as (DiegoCar & { own: boolean })[]
  const ownCarIds = cars.filter((c) => c.own).map((c) => c.id)

  const [jobs, ingress, sessions] = await Promise.all([
    ownCarIds.length
      ? query(
          `SELECT rid, car_id, term, state, created_at, user_name FROM diego_web.jobs
            WHERE car_id = ANY($1::bigint[]) AND NOT COALESCE(hidden, false)
            ORDER BY created_at DESC LIMIT 400`, [ownCarIds])
      : Promise.resolve({ rows: [] }),
    ownCarIds.length
      ? query(
          `SELECT rid, channel, chat_name, text, car_id, created_at, status FROM diego_web.ingress
            WHERE car_id = ANY($1::bigint[]) AND NOT COALESCE(hidden, false)
            ORDER BY created_at DESC LIMIT 200`, [ownCarIds])
      : Promise.resolve({ rows: [] }),
    query(
      `SELECT id, car_id, channel, who, started_at, last_at FROM diego_web.sessions
        WHERE customer_code = $1 AND NOT COALESCE(hidden, false)
        ORDER BY started_at DESC LIMIT 200`, [padded]),
  ])

  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ''))
  return diegoEvents({
    cars,
    jobs: (jobs.rows as DiegoJob[]).map((j) => ({ ...j, created_at: iso(j.created_at) })),
    ingress: (ingress.rows as DiegoIngress[]).map((m) => ({ ...m, created_at: iso(m.created_at) })),
    sessions: (sessions.rows as DiegoSession[]).map((s) => ({
      ...s, started_at: iso(s.started_at), last_at: s.last_at ? iso(s.last_at) : null,
    })),
  })
}

/**
 * When the document list came back full, older documents exist that it does
 * not show — the oldest day it reached is where the timeline stops being
 * complete for quotes/invoices, and the tab says so.
 */
function docsSince(rows: Record<string, unknown>[]): string | undefined {
  if (rows.length < DOC_LIMIT) return undefined
  const days = documentEvents(rows).map((e) => e.at).sort()
  return days[0]
}

async function finapiSource(code: string, padded: string): Promise<{ events: TimelineEvent[]; calls: number; since?: string }> {
  // Same key the history route writes (it is keyed by the URL code as given).
  type History = { documents?: Record<string, unknown>[]; receipts?: Record<string, unknown>[]; partial?: boolean }
  let hist = await getCached<History>(`customer:history:v1:${code}`)
  if (!hist && padded !== code) hist = await getCached<History>(`customer:history:v1:${padded}`)
  if (hist && !hist.partial && Array.isArray(hist.documents) && Array.isArray(hist.receipts)) {
    return {
      events: [...documentEvents(hist.documents), ...receiptEvents(hist.receipts)],
      calls: 0,
      since: docsSince(hist.documents),
    }
  }

  const listParams = (limit: number) => ({ limit, direction: 'desc' })
  const [docs, rcpts] = await Promise.allSettled([
    fetchCustomerDocumentsSlow(code, listParams(DOC_LIMIT)),
    fetchCustomerReceiptsSlow(code, listParams(RECEIPT_LIMIT)),
  ])
  if (docs.status === 'rejected' && rcpts.status === 'rejected') throw docs.reason
  const docRows = docs.status === 'fulfilled' ? (docs.value?.documents || docs.value || []) : []
  const rcptRows = rcpts.status === 'fulfilled' ? (rcpts.value?.receipts || rcpts.value?.documents || rcpts.value || []) : []
  // One half failing is still a failure of the source: say so rather than
  // presenting a timeline with no payments as if none were made.
  if (docs.status === 'rejected' || rcpts.status === 'rejected') {
    const err = new Error(docs.status === 'rejected' ? 'documents unavailable' : 'receipts unavailable')
    ;(err as Error & { partialEvents?: TimelineEvent[] }).partialEvents = [
      ...documentEvents(Array.isArray(docRows) ? docRows : []),
      ...receiptEvents(Array.isArray(rcptRows) ? rcptRows : []),
    ]
    throw err
  }
  return {
    events: [
      ...documentEvents(Array.isArray(docRows) ? docRows : []),
      ...receiptEvents(Array.isArray(rcptRows) ? rcptRows : []),
    ],
    calls: 2,
    since: docsSince(Array.isArray(docRows) ? docRows : []),
  }
}

const FS_TO_PAGE_STATUS: Record<string, string> = {
  assigned: 'assigned', started: 'in_transit', delivered: 'delivered', failed: 'failed',
}

async function deliveriesSource(code: string): Promise<TimelineEvent[]> {
  const db = await getDeliveryFirestore()
  const base = db.collection('shipments').where('customerId', 'in', customerCodeVariants(code))
  // Newest N needs a composite index (customerId, createdAt). Without one,
  // Firestore answers FAILED_PRECONDITION and an unordered `limit` would hand
  // back an ARBITRARY N — for a busy customer, last year's deliveries and not
  // this week's. So the fallback reads all of the customer's deliveries (one
  // equality query, no index needed) and keeps the newest N here.
  let snap: FirebaseFirestore.QuerySnapshot
  try {
    snap = await base.orderBy('createdAt', 'desc').limit(DELIVERY_LIMIT).get()
  } catch (e) {
    if ((e as { code?: number }).code !== 9) throw e
    console.warn('[timeline] deliveries: no (customerId, createdAt) index — reading all of the customer\'s deliveries')
    snap = await base.get()
  }
  const rows: DeliveryRow[] = snap.docs.map((d) => {
    const r = d.data() as Record<string, unknown>
    const str = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v))
    return {
      id: d.id,
      documentNumber: str(r.documentNumber) ?? str(r.orderNumber),
      status: FS_TO_PAGE_STATUS[String(r.status)] || str(r.status) || 'assigned',
      driverName: str(r.assignedToName),
      notes: str(r.notes),
      assignedAt: toIso(r.assignedAt),
      startedAt: toIso(r.startedAt),
      deliveredAt: toIso(r.deliveredAt),
      createdAt: toIso(r.createdAt),
    }
  })
  return deliveryEvents(rows)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, DELIVERY_LIMIT)
}

async function heldSource(code: string): Promise<TimelineEvent[]> {
  const rows = await heldOrdersForCustomer(customerCodeVariants(code))
  return heldEvents(rows.map((r) => ({
    ...(r as HeldOrderRow),
    created_at: toIso(r.created_at),
    // No arrival timestamp column: `completed_at` is when the order was closed,
    // which for a fully arrived order is the closest thing to "arrived".
    arrived_at: toIso(r.arrived_at ?? (r.arrival_status === 'full' ? r.completed_at : null) ?? null),
  })))
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 200) : 'unavailable'
}

async function build(code: string): Promise<TimelinePayload> {
  const padded = padCustomerCode(code)
  const [diego, finapi, deliveries, held] = await Promise.allSettled([
    diegoSource(padded),
    finapiSource(code, padded),
    deliveriesSource(code),
    heldSource(code),
  ])

  const sources = {} as Record<TimelineSource, SourceStatus>
  const lists: TimelineEvent[][] = []
  let finapiCalls = 0
  let finapiSince: string | undefined

  const take = (name: TimelineSource, r: PromiseSettledResult<TimelineEvent[]>) => {
    if (r.status === 'fulfilled') {
      sources[name] = { ok: true, count: r.value.length }
      lists.push(r.value)
    } else {
      console.warn(`[timeline] ${name} failed for ${code}:`, errMessage(r.reason))
      sources[name] = { ok: false, error: errMessage(r.reason) }
    }
  }
  take('diego', diego)
  take('deliveries', deliveries)
  take('held', held)
  if (finapi.status === 'fulfilled') {
    sources.finapi = { ok: true, count: finapi.value.events.length }
    lists.push(finapi.value.events)
    finapiCalls = finapi.value.calls
    finapiSince = finapi.value.since
  } else {
    const partial = (finapi.reason as { partialEvents?: TimelineEvent[] })?.partialEvents
    if (partial) {
      lists.push(partial)
      finapiCalls = 2
    }
    console.warn(`[timeline] finapi failed for ${code}:`, errMessage(finapi.reason))
    sources.finapi = { ok: false, error: errMessage(finapi.reason) }
  }

  return {
    code,
    events: mergeTimeline(...lists),
    sources,
    finapiCalls,
    finapiSince,
    generatedAt: new Date().toISOString(),
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    await initializeSecrets()
    const { code: raw } = await params
    const code = decodeURIComponent(raw).trim()
    if (!/^\d{1,10}$/.test(code)) {
      return NextResponse.json({ error: 'bad customer code' }, { status: 400 })
    }
    const cacheKey = `customer:timeline:${CACHE_VERSION}:${padCustomerCode(code)}`

    // No ?refresh: a refresh button on a single-seat ERP is a polling loop with
    // extra steps. The cache expiring is the refresh.
    const cached = await getCached<TimelinePayload>(cacheKey)
    if (cached) return NextResponse.json({ ...cached, cached: true })

    let p = inflight.get(cacheKey)
    if (!p) {
      p = build(code).finally(() => inflight.delete(cacheKey))
      inflight.set(cacheKey, p)
      const payload = await p
      const allOk = Object.values(payload.sources).every((s) => s.ok)
      await setCache(cacheKey, payload, allOk ? CACHE_TTL : PARTIAL_TTL)
      return NextResponse.json(payload)
    }
    return NextResponse.json(await p)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}
