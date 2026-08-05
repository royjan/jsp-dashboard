export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { normalizeOemCode } from '@/lib/competitors/parse-sheets'

/**
 * Price/stock history for an item across all uploads, per competitor.
 * ?codes=0249E6,ADB116702 — any of the codes (normalized) matches either the
 * stored item_code or a Comet OEM cross-code. Query param (not a path segment)
 * because raw codes may contain dots.
 */
export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const codesParam = searchParams.get('codes') || searchParams.get('code') || ''
    const codes = [...new Set(codesParam.split(',').map(normalizeOemCode).filter(Boolean))]
    if (!codes.length) {
      return NextResponse.json({ error: 'codes query param is required' }, { status: 400 })
    }

    const { rows } = await query(`
      SELECT c.name AS competitor, u.uploaded_at, ci.item_code, ci.net_price, ci.gross_price,
             ci.stock_qty, ci.stock_status
      FROM dashboard.competitor_items ci
      JOIN dashboard.competitors c ON c.id = ci.competitor_id
      JOIN dashboard.competitor_uploads u ON u.id = ci.upload_id
      WHERE u.status = 'completed' AND (ci.item_code = ANY($1) OR ci.oem_codes && $1)
      ORDER BY c.name, u.uploaded_at
    `, [codes])

    const series = new Map<string, Array<Record<string, unknown>>>()
    for (const r of rows as Array<{ competitor: string; uploaded_at: string; net_price: number | null; gross_price: number | null; stock_qty: number | null; stock_status: string }>) {
      if (!series.has(r.competitor)) series.set(r.competitor, [])
      series.get(r.competitor)!.push({
        uploadedAt: r.uploaded_at,
        netPrice: r.net_price,
        grossPrice: r.gross_price,
        stockQty: r.stock_qty,
        stockStatus: r.stock_status,
      })
    }

    return NextResponse.json({
      codes,
      series: [...series.entries()].map(([competitor, points]) => ({ competitor, points })),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'failed' },
      { status: 500 },
    )
  }
}
