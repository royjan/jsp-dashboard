export const runtime = 'nodejs'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { fetchBatchCost } from '@/lib/finansit-client'
import type { FakeStatus } from '@/lib/fake-scan'

/**
 * Competitor prices at or under what the part costs us — the counterfeit tell.
 *
 * Three sources, one query, no writes:
 *  - `dashboard.competitor_items` (latest snapshot per competitor) — the price.
 *    This is the dashboard's own uploaded data rather than the portal's PSA
 *    feed because it is wider (542 costed codes against 392) and it carries the
 *    genuine/aftermarket call, without which the comparison is meaningless.
 *  - `public.portal_item_costs` — the cost, and CRUCIALLY its `cost_date`. The
 *    portal caches these while pricing, so the join is free; FINAPI is only
 *    touched when someone explicitly asks to re-cost a row (POST below).
 *  - `public.portal_competitor_prices.fake_status` — the admin's existing
 *    verdict in the portal, read so a row someone already cleared is not
 *    presented here as news. Nothing writes back: the portal owns that column
 *    and the customer-facing stamp that follows from it.
 *
 * Classification is deliberately NOT done here. The threshold is a slider on
 * the page and 113 candidate rows re-classify instantly in the browser via
 * `lib/fake-scan.ts`, so the server returns the raw numbers and no opinion.
 */

/** Widest band returned: a competitor at 1.5x our cost is not interesting, but
 *  the slider needs headroom above the 10% default to be worth dragging. */
const CANDIDATE_BAND = 1.5

export interface FakeCandidateRow {
  itemCode: string
  rawCode: string
  /** The competitor's own description — often the only Hebrew name we have. */
  competitorName: string | null
  competitor: string
  netPrice: number
  grossPrice: number | null
  cost: number
  costDate: string | null
  costFetchedAt: string | null
  costCurrency: string | null
  /** Our catalogue, where the portal has mirrored it. */
  erpName: string | null
  listPrice: number | null
  inStock: number | null
  soldThisYear: number | null
  /** The portal's admin verdict, when the code exists in its feed. */
  fakeStatus: FakeStatus | null
  fakeFlaggedAt: string | null
}

export interface FakesResponse {
  computedAt: string
  band: number
  rows: FakeCandidateRow[]
  counts: {
    /** Genuine competitor rows we have a cost for — the population judged. */
    costedRows: number
    /** Of those, the ones inside the candidate band (what `rows` holds). */
    candidates: number
    /** Competitor codes with no cost on file: NOT innocent, just unjudgeable. */
    noCostBasis: number
    /** Snapshot age, so the page can say how old the prices themselves are. */
    lastUploadAt: string | null
  }
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null)

export async function GET() {
  try {
    await initializeSecrets()

    const rowsSql = `
      WITH latest AS (
        SELECT ci.item_code, ci.raw_code, ci.name, c.name AS competitor,
               COALESCE(ci.net_price, ci.gross_price) AS price,
               ci.gross_price
          FROM dashboard.competitor_items ci
          JOIN dashboard.competitors c
            ON c.id = ci.competitor_id AND c.latest_upload_id = ci.upload_id
         WHERE COALESCE(ci.net_price, ci.gross_price) > 0
           -- An aftermarket part costing less than the OEM part is ordinary
           -- trade, not a tell. Only a claimed ORIGINAL can be a counterfeit.
           AND ci.genuineness = 'genuine'
      ),
      best AS (
        -- One row per competitor per code: their cheapest listing is the one
        -- that has to clear the bar.
        SELECT DISTINCT ON (item_code, competitor) *
          FROM latest
         ORDER BY item_code, competitor, price ASC
      )
      SELECT b.item_code, b.raw_code, b.name, b.competitor, b.price, b.gross_price,
             pc.cost, pc.cost_date, pc.fetched_at, pc.currency,
             s.erp_name, s.list_price, s.in_stock, s.sold_this_year,
             pp.fake_status, pp.fake_flagged_at
        FROM best b
        JOIN public.portal_item_costs pc ON pc.item_code = b.item_code
        LEFT JOIN public.portal_item_stats s ON s.item_code = b.item_code
        LEFT JOIN public.portal_competitor_prices pp ON pp.item_code = b.item_code
       WHERE pc.cost > 0 AND b.price <= pc.cost * $1
       ORDER BY b.price / pc.cost ASC`

    const countsSql = `
      WITH latest AS (
        SELECT ci.item_code, COALESCE(ci.net_price, ci.gross_price) AS price, ci.genuineness
          FROM dashboard.competitor_items ci
          JOIN dashboard.competitors c
            ON c.id = ci.competitor_id AND c.latest_upload_id = ci.upload_id
         WHERE COALESCE(ci.net_price, ci.gross_price) > 0
      )
      SELECT
        count(*) FILTER (WHERE l.genuineness = 'genuine' AND pc.cost > 0)::int AS costed_rows,
        count(*) FILTER (
          WHERE l.genuineness = 'genuine' AND pc.cost > 0 AND l.price <= pc.cost * $1
        )::int AS candidates,
        count(DISTINCT l.item_code) FILTER (WHERE pc.item_code IS NULL)::int AS no_cost_basis,
        (SELECT max(uploaded_at) FROM dashboard.competitor_uploads) AS last_upload_at
      FROM latest l
      LEFT JOIN public.portal_item_costs pc ON pc.item_code = l.item_code`

    const [rowsRes, countsRes] = await Promise.all([
      query(rowsSql, [CANDIDATE_BAND]),
      query(countsSql, [CANDIDATE_BAND]),
    ])

    const rows: FakeCandidateRow[] = rowsRes.rows.map(r => ({
      itemCode: String(r.item_code),
      rawCode: String(r.raw_code ?? r.item_code),
      competitorName: r.name ?? null,
      competitor: String(r.competitor),
      netPrice: Number(r.price),
      grossPrice: num(r.gross_price),
      cost: Number(r.cost),
      costDate: iso(r.cost_date),
      costFetchedAt: iso(r.fetched_at),
      costCurrency: r.currency ?? null,
      erpName: r.erp_name ?? null,
      listPrice: num(r.list_price),
      inStock: num(r.in_stock),
      soldThisYear: num(r.sold_this_year),
      fakeStatus: (r.fake_status ?? null) as FakeStatus | null,
      fakeFlaggedAt: iso(r.fake_flagged_at),
    }))

    const c = countsRes.rows[0] ?? {}
    const body: FakesResponse = {
      computedAt: new Date().toISOString(),
      band: CANDIDATE_BAND,
      rows,
      counts: {
        costedRows: Number(c.costed_rows ?? 0),
        candidates: Number(c.candidates ?? 0),
        noCostBasis: Number(c.no_cost_basis ?? 0),
        lastUploadAt: iso(c.last_upload_at),
      },
    }
    return NextResponse.json(body)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to scan competitor prices' },
      { status: 500 },
    )
  }
}

/** How many codes one re-cost may ask FINAPI for. The stale suspects at the
 *  default threshold number a few dozen; this is headroom, not a target. */
const MAX_LIVE_CODES = 200

export interface LiveCostResponse {
  fetchedAt: string
  costs: Record<string, number>
  /** Codes asked for that FINAPI had no cost for — absence, stated. */
  missing: string[]
}

/**
 * Re-cost specific codes against FINAPI.
 *
 * The reason this exists: run the portal's rule over today's data and 23 of the
 * 24 flagged rows are judged against a cost older than 18 months, i.e. the rule
 * is mostly detecting our own stale costs. The dashboard is the side that can
 * settle it — one batched price-code-06 read turns "we do not know" into a
 * verdict. Bounded and explicit: it only runs when someone presses the button.
 */
export async function POST(request: Request) {
  try {
    await initializeSecrets()
    const body = await request.json().catch(() => ({}))
    const codes: string[] = Array.isArray(body?.codes)
      ? [...new Set((body.codes as unknown[]).map(c => String(c ?? '').trim().toUpperCase()).filter(Boolean))]
      : []

    if (!codes.length) return NextResponse.json({ error: 'codes[] is required' }, { status: 400 })
    if (codes.length > MAX_LIVE_CODES) {
      return NextResponse.json(
        { error: `too many codes (${codes.length} > ${MAX_LIVE_CODES})` },
        { status: 400 },
      )
    }

    const costs = await fetchBatchCost(codes)
    const missing = codes.filter(c => !(c in costs))
    const res: LiveCostResponse = { fetchedAt: new Date().toISOString(), costs, missing }
    return NextResponse.json(res)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch live costs' },
      { status: 500 },
    )
  }
}
