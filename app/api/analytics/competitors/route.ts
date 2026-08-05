export const runtime = 'nodejs'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getItems } from '@/lib/services/analytics-service'
import { query } from '@/lib/db'
import { getCached, setCache } from '@/lib/redis-client'
import { CACHE_TTL, CACHE_VERSIONS } from '@/lib/constants'
import { normalizeOemCode, type StockStatus } from '@/lib/competitors/parse-sheets'
import type { FinansitItem } from '@/lib/types'

export interface CompetitorCell {
  netPrice: number | null
  grossPrice: number | null
  stockQty: number | null
  stockStatus: StockStatus
  rawCode: string
  itemCode: string
}

export interface CompareRow {
  code: string
  name: string
  ourPrice: number | null
  ourStock: number
  soldThisYear: number
  competitors: Record<string, CompetitorCell>
  minCompetitorNet: number | null
  maxCompetitorNet: number | null
  cheapestCompetitor: string | null // competitor name, or 'Jan' when we beat them all
  spreadPct: number | null          // min competitor net vs our price; negative = they're cheaper
  flags: { theyStockWeDont: boolean; cheaperThanUs: boolean }
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
  unmatched: Array<{ itemCode: string; rawCode: string; name: string | null; netPrice: number | null; stockStatus: StockStatus; competitors: string[] }>
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
  oem_codes: string[] | null
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
             ci.net_price, ci.stock_qty, ci.stock_status, ci.oem_codes
      FROM dashboard.competitor_items ci
      JOIN dashboard.competitors c ON c.id = ci.competitor_id AND ci.upload_id = c.latest_upload_id
      WHERE c.active
    `)).rows as SnapshotRow[]

    // Jan catalog index: every normalized code in an item's chain → the item.
    const items = await getItems()
    const codeIndex = new Map<string, FinansitItem>()
    for (const it of items) {
      for (const c of [it.code, ...(it.alias_codes || []), ...(it.chain_history || []), ...(it.item_id_history || [])]) {
        const norm = normalizeOemCode(c)
        if (norm && !codeIndex.has(norm)) codeIndex.set(norm, it)
      }
    }

    const matchItem = (row: SnapshotRow): FinansitItem | null => {
      const direct = codeIndex.get(row.item_code)
      if (direct) return direct
      for (const oem of row.oem_codes || []) {
        const hit = codeIndex.get(oem)
        if (hit) return hit
      }
      return null
    }

    const rowsByJanCode = new Map<string, CompareRow>()
    const unmatchedByCode = new Map<string, CompetitorCompareResponse['unmatched'][number]>()

    for (const row of snapshot) {
      const item = matchItem(row)
      if (!item) {
        const existing = unmatchedByCode.get(row.item_code)
        if (existing) {
          if (!existing.competitors.includes(row.competitor_name)) existing.competitors.push(row.competitor_name)
        } else {
          unmatchedByCode.set(row.item_code, {
            itemCode: row.item_code,
            rawCode: row.raw_code,
            name: row.name,
            netPrice: row.net_price,
            stockStatus: row.stock_status,
            competitors: [row.competitor_name],
          })
        }
        continue
      }

      let out = rowsByJanCode.get(item.code)
      if (!out) {
        out = {
          code: item.code,
          name: (item.name || '').trim(),
          ourPrice: item.price > 0 ? Math.round(item.price * 100) / 100 : null,
          ourStock: Math.round(item.stock_qty || 0),
          soldThisYear: Math.max(0, Math.round(item.sold_this_year || 0)),
          competitors: {},
          minCompetitorNet: null,
          maxCompetitorNet: null,
          cheapestCompetitor: null,
          spreadPct: null,
          flags: { theyStockWeDont: false, cheaperThanUs: false },
        }
        rowsByJanCode.set(item.code, out)
      }
      // Same Jan item may match several competitor codes of one competitor
      // (chain aliases); keep the first cell per competitor.
      if (!out.competitors[row.competitor_name]) {
        out.competitors[row.competitor_name] = {
          netPrice: row.net_price,
          grossPrice: row.gross_price,
          stockQty: row.stock_qty,
          stockStatus: row.stock_status,
          rawCode: row.raw_code,
          itemCode: row.item_code,
        }
      }
    }

    const rows: CompareRow[] = []
    for (const out of rowsByJanCode.values()) {
      let minNet: number | null = null
      let maxNet: number | null = null
      let cheapest: string | null = null
      let anyStock = false
      for (const [name, cell] of Object.entries(out.competitors)) {
        if (cell.netPrice != null) {
          if (minNet === null || cell.netPrice < minNet) { minNet = cell.netPrice; cheapest = name }
          if (maxNet === null || cell.netPrice > maxNet) maxNet = cell.netPrice
        }
        if (cell.stockStatus === 'in_stock') anyStock = true
      }
      out.minCompetitorNet = minNet
      out.maxCompetitorNet = maxNet
      out.spreadPct = minNet != null && out.ourPrice ? Math.round((minNet / out.ourPrice - 1) * 100) : null
      out.flags.cheaperThanUs = minNet != null && out.ourPrice != null && minNet < out.ourPrice
      out.cheapestCompetitor = minNet == null ? null : (out.ourPrice != null && out.ourPrice <= minNet ? 'Jan' : cheapest)
      out.flags.theyStockWeDont = anyStock && out.ourStock === 0
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
        matchedItems: rows.length,
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
