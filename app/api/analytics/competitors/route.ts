export const runtime = 'nodejs'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getItems } from '@/lib/services/analytics-service'
import { query } from '@/lib/db'
import { getCached, setCache } from '@/lib/redis-client'
import { CACHE_TTL, CACHE_VERSIONS } from '@/lib/constants'
import { normalizeOemCode, type StockStatus, type Genuineness } from '@/lib/competitors/parse-sheets'
import type { FinansitItem } from '@/lib/types'

export interface CompetitorCell {
  netPrice: number | null
  grossPrice: number | null
  stockQty: number | null
  stockStatus: StockStatus
  genuineness: Genuineness
  rawCode: string
  itemCode: string
  /**
   * True when this competitor does NOT list this part under its own code — we
   * only reached it through one of their OEM cross-reference codes. Their price
   * is for a different (superseding/alternative) part number, so it is shown
   * for reference and excluded from cheapest/spread/flag maths.
   */
  crossRef: boolean
}

export interface CompareRow {
  code: string
  name: string
  ourPrice: number | null
  ourStock: number
  soldThisYear: number
  genuineness: Genuineness
  competitors: Record<string, CompetitorCell>
  minCompetitorNet: number | null
  maxCompetitorNet: number | null
  cheapestCompetitor: string | null // competitor name, or 'Jan' when we beat them all
  spreadPct: number | null          // min competitor net vs our price; negative = they're cheaper
  flags: { theyStockWeDont: boolean; cheaperThanUs: boolean }
  /** Data-quality notes (net above gross, implausible spread, …). */
  warnings: string[]
}

export interface CompetitorCompareResponse {
  computedAt: string
  competitors: Array<{ id: string; name: string; lastUploadAt: string | null; itemCount: number }>
  kpis: {
    matchedItems: number
    cheaperThanUs: number
    theyStockWeDont: number
    unmatchedCompetitorItems: number
  }
  rows: CompareRow[]
  unmatched: Array<{ itemCode: string; rawCode: string; name: string | null; netPrice: number | null; stockStatus: StockStatus; genuineness: Genuineness; competitors: string[] }>
}

type SnapshotRow = {
  competitor_name: string
  item_code: string
  raw_code: string
  name: string | null
  gross_price: number | null
  net_price: number | null
  stock_qty: number | null
  stock_status: StockStatus
  genuineness: Genuineness
  oem_codes: string[] | null
}

/**
 * Prices/quantities arrive as NUMERIC — keep only finite, sane values.
 * null must survive as null: a competitor who reports "in stock" without a
 * number has an UNKNOWN quantity, and Number(null) === 0 would render that as
 * a hard zero (i.e. "out of stock"), which is the opposite of the truth.
 */
function sanePrice(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return null
  return Math.round(n * 100) / 100
}

function saneQty(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0 || n > 100_000) return null
  return Math.round(n)
}

// Latest competitor snapshots vs live Jan catalog (price + stock from getItems).
export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const refresh = searchParams.get('refresh') === '1'

    const cacheKey = CACHE_VERSIONS.COMPETITOR_COMPARE
    if (!refresh) {
      const cached = await getCached<CompetitorCompareResponse>(cacheKey)
      if (cached) return NextResponse.json(cached)
    }

    const competitorsMeta = (await query(`
      SELECT c.id, c.name, u.uploaded_at AS last_upload_at,
             (SELECT count(*) FROM dashboard.competitor_items ci WHERE ci.upload_id = c.latest_upload_id AND ci.competitor_id = c.id) AS item_count
      FROM dashboard.competitors c
      LEFT JOIN dashboard.competitor_uploads u ON u.id = c.latest_upload_id
      WHERE c.active
      ORDER BY c.name
    `)).rows as Array<{ id: string; name: string; last_upload_at: string | null; item_count: number }>

    const snapshot = (await query(`
      SELECT c.name AS competitor_name, ci.item_code, ci.raw_code, ci.name, ci.gross_price,
             ci.net_price, ci.stock_qty, ci.stock_status, ci.genuineness, ci.oem_codes
      FROM dashboard.competitor_items ci
      JOIN dashboard.competitors c ON c.id = ci.competitor_id AND ci.upload_id = c.latest_upload_id
      WHERE c.active
    `)).rows as SnapshotRow[]

    // Jan catalog index: every normalized code in an item's chain → the item.
    // Placeholder/fee pseudo-items are skipped (same junk filter the eBay
    // recommender uses) — otherwise a competitor SKU can land on an item whose
    // code is literally '0'.
    const items = await getItems()
    const codeIndex = new Map<string, FinansitItem>()
    for (const it of items) {
      const name = (it.name || '').trim()
      if (!name || name.length < 2 || ['!', '.', '-', '----'].includes(name)) continue
      if (it.code.length <= 3 && /^\d+$/.test(it.code)) continue
      for (const c of [it.code, ...(it.alias_codes || []), ...(it.chain_history || []), ...(it.item_id_history || [])]) {
        const norm = normalizeOemCode(c)
        // a 1-2 char code carries no identifying information
        if (norm.length < 3) continue
        if (norm && !codeIndex.has(norm)) codeIndex.set(norm, it)
      }
    }

    const rowsByJanCode = new Map<string, CompareRow>()
    const unmatchedByCode = new Map<string, CompetitorCompareResponse['unmatched'][number]>()

    const ensureRow = (item: FinansitItem): CompareRow => {
      let out = rowsByJanCode.get(item.code)
      if (!out) {
        out = {
          code: item.code,
          name: (item.name || '').trim(),
          ourPrice: sanePrice(item.price),
          ourStock: saneQty(item.stock_qty) ?? 0,
          soldThisYear: Math.max(0, saneQty(item.sold_this_year) ?? 0),
          genuineness: 'unknown',
          competitors: {},
          minCompetitorNet: null,
          maxCompetitorNet: null,
          cheapestCompetitor: null,
          spreadPct: null,
          flags: { theyStockWeDont: false, cheaperThanUs: false },
          warnings: [],
        }
        rowsByJanCode.set(item.code, out)
      }
      return out
    }

    const toCell = (row: SnapshotRow, crossRef: boolean): CompetitorCell => ({
      netPrice: sanePrice(row.net_price),
      grossPrice: sanePrice(row.gross_price),
      stockQty: saneQty(row.stock_qty),
      stockStatus: row.stock_status,
      genuineness: row.genuineness ?? 'unknown',
      rawCode: row.raw_code,
      itemCode: row.item_code,
      crossRef,
    })

    // Pass 1 — direct matches only: the competitor lists this part under a code
    // that resolves to one of our catalog codes (incl. our alias/supersession
    // chains). These are the only cells that count as "their price for this part".
    const crossRefCandidates: SnapshotRow[] = []
    for (const row of snapshot) {
      const item = codeIndex.get(row.item_code)
      if (!item) {
        crossRefCandidates.push(row)
        continue
      }
      const out = ensureRow(item)
      if (!out.competitors[row.competitor_name] || out.competitors[row.competitor_name].crossRef) {
        out.competitors[row.competitor_name] = toCell(row, false)
      }
    }

    // Pass 2 — cross-reference fallback. A competitor row whose own code we don't
    // carry may still name one of our codes in its OEM list (a superseding part).
    // Attach it flagged, and never overwrite a direct match.
    for (const row of crossRefCandidates) {
      let item: FinansitItem | null = null
      for (const oem of row.oem_codes || []) {
        const hit = codeIndex.get(oem)
        if (hit) { item = hit; break }
      }
      if (!item) {
        const existing = unmatchedByCode.get(row.item_code)
        if (existing) {
          if (!existing.competitors.includes(row.competitor_name)) existing.competitors.push(row.competitor_name)
        } else {
          unmatchedByCode.set(row.item_code, {
            itemCode: row.item_code,
            rawCode: row.raw_code,
            name: row.name,
            netPrice: sanePrice(row.net_price),
            stockStatus: row.stock_status,
            genuineness: row.genuineness ?? 'unknown',
            competitors: [row.competitor_name],
          })
        }
        continue
      }
      const out = ensureRow(item)
      if (!out.competitors[row.competitor_name]) {
        out.competitors[row.competitor_name] = toCell(row, true)
      }
    }

    const rows: CompareRow[] = []
    for (const out of rowsByJanCode.values()) {
      let minNet: number | null = null
      let maxNet: number | null = null
      let cheapest: string | null = null
      let anyStock = false
      const seenGenuineness = new Set<Genuineness>()

      for (const [name, cell] of Object.entries(out.competitors)) {
        // Cross-reference cells describe a different part number — reference only.
        if (cell.crossRef) continue
        if (cell.genuineness !== 'unknown') seenGenuineness.add(cell.genuineness)
        if (cell.netPrice != null) {
          if (cell.grossPrice != null && cell.netPrice > cell.grossPrice) {
            out.warnings.push(`${name}: net above gross`)
          }
          if (minNet === null || cell.netPrice < minNet) { minNet = cell.netPrice; cheapest = name }
          if (maxNet === null || cell.netPrice > maxNet) maxNet = cell.netPrice
        }
        if (cell.stockStatus === 'in_stock') anyStock = true
      }

      out.genuineness = seenGenuineness.size === 1 ? [...seenGenuineness][0] : (seenGenuineness.size > 1 ? 'aftermarket' : 'unknown')
      out.minCompetitorNet = minNet
      out.maxCompetitorNet = maxNet
      out.spreadPct = minNet != null && out.ourPrice ? Math.round((minNet / out.ourPrice - 1) * 100) : null
      out.flags.cheaperThanUs = minNet != null && out.ourPrice != null && minNet < out.ourPrice
      out.cheapestCompetitor = minNet == null ? null : (out.ourPrice != null && out.ourPrice <= minNet ? 'Jan' : cheapest)
      out.flags.theyStockWeDont = anyStock && out.ourStock === 0

      // An order-of-magnitude gap is nearly always a unit/packaging mismatch
      // (single vs kit) rather than a real price difference — flag, don't hide.
      if (out.spreadPct != null && (out.spreadPct <= -90 || out.spreadPct >= 400)) {
        out.warnings.push('implausible price gap — check units/packaging')
      }
      if (out.ourPrice == null) out.warnings.push('no Jan price')

      rows.push(out)
    }

    // Most actionable first: they stock what we're out of, then deepest undercut.
    rows.sort((a, b) => {
      if (a.flags.theyStockWeDont !== b.flags.theyStockWeDont) return a.flags.theyStockWeDont ? -1 : 1
      return (a.spreadPct ?? 999) - (b.spreadPct ?? 999)
    })

    const response: CompetitorCompareResponse = {
      computedAt: new Date().toISOString(),
      competitors: competitorsMeta.map(c => ({
        id: c.id,
        name: c.name,
        lastUploadAt: c.last_upload_at,
        itemCount: Number(c.item_count) || 0,
      })),
      kpis: {
        matchedItems: rows.filter(r => Object.values(r.competitors).some(c => !c.crossRef)).length,
        cheaperThanUs: rows.filter(r => r.flags.cheaperThanUs).length,
        theyStockWeDont: rows.filter(r => r.flags.theyStockWeDont).length,
        unmatchedCompetitorItems: unmatchedByCode.size,
      },
      rows,
      unmatched: [...unmatchedByCode.values()],
    }

    // A degraded getItems() fallback (tiny catalog) produces mostly-unmatched
    // rows — return it, but don't cache it for 3h.
    if (items.length >= 1000) {
      await setCache(cacheKey, response, CACHE_TTL.ANALYTICS)
    }
    return NextResponse.json(response)
  } catch (error) {
    console.error('[analytics/competitors] failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed' },
      { status: 500 },
    )
  }
}
