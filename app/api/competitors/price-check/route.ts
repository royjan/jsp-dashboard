export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'

/**
 * What we know about a list of item codes someone pasted in.
 *
 * A price list does not always arrive as a workbook — a supplier or a rep sends
 * twenty lines in a message, and the competitor uploader (an `.xlsx` with a
 * sheet per competitor, versioned as a snapshot) is far too much machinery for
 * that. This answers the only question such a list raises: for each code, what
 * does it cost us, what do we sell it for, do we have any, and what is the best
 * competitor price already on file.
 *
 * Everything comes from the shared Neon database — the portal's cached costs
 * and ERP mirror plus this app's own competitor snapshots. NO FINAPI CALL, so a
 * 300-line paste costs one query rather than three hundred round trips. The
 * price of that is the cost's age, which is returned rather than hidden:
 * `cost_date` is what the cost was dated, `cost_fetched_at` is when the portal
 * last read it.
 */

/** A paste larger than this is a workbook, and belongs in the uploader. */
const MAX_CODES = 500

export interface PriceCheckHit {
  /** Normalised comparison form — the key the client asked under. */
  code: string
  /** The code as the ERP spells it. */
  itemCode: string
  cost: number | null
  costDate: string | null
  costFetchedAt: string | null
  erpName: string | null
  listPrice: number | null
  inStock: number | null
  soldThisYear: number | null
  /** Cheapest price any competitor's latest snapshot carries for this code. */
  bestCompetitorPrice: number | null
  bestCompetitor: string | null
}

export interface PriceCheckResponse {
  checkedAt: string
  hits: PriceCheckHit[]
  /** Codes we hold nothing at all on — reported, never silently dropped. */
  unknown: string[]
}

/** Mirrors `normalizeCode()` in lib/paste-prices.ts, in SQL. */
const NORM = (col: string) => `regexp_replace(upper(${col}), '[^A-Z0-9]', '', 'g')`

export async function POST(request: Request) {
  try {
    await initializeSecrets()
    const body = await request.json().catch(() => ({}))
    const codes: string[] = Array.isArray(body?.codes)
      ? [...new Set((body.codes as unknown[]).map(c => String(c ?? '').trim().toUpperCase()).filter(Boolean))]
      : []

    if (!codes.length) return NextResponse.json({ error: 'codes[] is required' }, { status: 400 })
    if (codes.length > MAX_CODES) {
      return NextResponse.json({ error: `too many codes (${codes.length} > ${MAX_CODES})` }, { status: 400 })
    }

    // The union of everything we might know a code by: a code can have a cost
    // without stats, stats without a cost, or exist only in a competitor's
    // sheet. Starting from any one table would drop the other two.
    const { rows } = await query(
      `WITH asked AS (SELECT unnest($1::text[]) AS code),
       comp AS (
         SELECT ci.item_code, c.name AS competitor,
                COALESCE(ci.net_price, ci.gross_price) AS price
           FROM dashboard.competitor_items ci
           JOIN dashboard.competitors c
             ON c.id = ci.competitor_id AND c.latest_upload_id = ci.upload_id
          WHERE COALESCE(ci.net_price, ci.gross_price) > 0
       )
       SELECT a.code,
              COALESCE(pc.item_code, s.item_code, cb.item_code) AS item_code,
              pc.cost, pc.cost_date, pc.fetched_at,
              s.erp_name, s.list_price, s.in_stock, s.sold_this_year,
              cb.price AS best_price, cb.competitor AS best_competitor
         FROM asked a
         LEFT JOIN public.portal_item_costs pc ON ${NORM('pc.item_code')} = a.code
         LEFT JOIN public.portal_item_stats  s ON ${NORM('s.item_code')}  = a.code
         LEFT JOIN LATERAL (
           SELECT co.item_code, co.competitor, co.price
             FROM comp co
            WHERE ${NORM('co.item_code')} = a.code
            ORDER BY co.price ASC
            LIMIT 1
         ) cb ON true`,
      [codes],
    )

    const hits: PriceCheckHit[] = []
    const unknown: string[] = []
    for (const r of rows) {
      if (!r.item_code) {
        unknown.push(String(r.code))
        continue
      }
      hits.push({
        code: String(r.code),
        itemCode: String(r.item_code),
        cost: r.cost === null || r.cost === undefined ? null : Number(r.cost),
        costDate: r.cost_date ? new Date(r.cost_date).toISOString() : null,
        costFetchedAt: r.fetched_at ? new Date(r.fetched_at).toISOString() : null,
        erpName: r.erp_name ?? null,
        listPrice: r.list_price === null || r.list_price === undefined ? null : Number(r.list_price),
        inStock: r.in_stock === null || r.in_stock === undefined ? null : Number(r.in_stock),
        soldThisYear:
          r.sold_this_year === null || r.sold_this_year === undefined ? null : Number(r.sold_this_year),
        bestCompetitorPrice: r.best_price === null || r.best_price === undefined ? null : Number(r.best_price),
        bestCompetitor: r.best_competitor ?? null,
      })
    }

    const res: PriceCheckResponse = { checkedAt: new Date().toISOString(), hits, unknown }
    return NextResponse.json(res)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to check prices' },
      { status: 500 },
    )
  }
}
