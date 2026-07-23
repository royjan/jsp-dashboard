// Which of this customer's invoices contain the item, within the purchases-tab
// days window.
//
// Data path: /api/documents/search per invoice format (fast, rides FINAPI's
// cached tiers, no result cap — unlike the customer /documents list, which
// quotes drown past ~2 weeks for active customers) → fetch each candidate
// document's lines through the shared 7-day doc-detail Redis cache and match
// the item. The bulk /api/documents/lines scan is NOT used: FINAPI silently
// truncates it to the most recent ~500 lines, and its item-filtered path 503s.
//
// Cost: ~0.6s per uncached document at pool 4 (~0.15s/doc effective); the
// per-doc cache is shared across items AND with the invoice-row drill-down, so
// only the first click per customer window is slow.
export const maxDuration = 300

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { searchDocuments } from '@/lib/finansit-client'
import { getDocumentDetailCached } from '@/lib/services/doc-detail'

// Same formats FINAPI's /customers/{code}/purchases aggregates (net of credits).
const INVOICE_FORMATS = ['11', '12', '13', '19']
const POOL = 4 // matches the client-wide FINAPI fan-out cap
const MAX_DOCS = 400 // ~60s of detail fetches; giant customers get a partial note

const normItem = (s: string) => String(s || '').trim().toUpperCase()

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string; itemCode: string }> }
) {
  try {
    await initializeSecrets()
    const { code, itemCode } = await params
    const { searchParams } = new URL(request.url)
    const days = Math.min(Number(searchParams.get('days') || '90'), 365)
    // The purchases row already knows its line_count; scanning newest-first we
    // can stop once that many matches are found instead of walking the whole
    // window. The client omits it when returns exist (credit-note rows would be
    // missed by an early stop).
    const expected = Math.max(0, Number(searchParams.get('expected') || '0'))
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)

    const perFormat = await Promise.all(
      INVOICE_FORMATS.map((fmt) =>
        searchDocuments({ customer_code: code, doc_format: fmt, date_from: cutoff }).catch(() => [])
      )
    )
    const candidates = perFormat
      .flat()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((d: any) => ({
        format: String(d.format || d.doc_format || ''),
        number: String(d.doc_number || d.number || ''),
        date: String(d.doc_date || d.date || '').slice(0, 10),
      }))
      .filter((d) => d.format && d.number)
      .sort((a, b) => b.date.localeCompare(a.date))
    const capped = candidates.length > MAX_DOCS
    const scanned = candidates.slice(0, MAX_DOCS)

    const want = normItem(itemCode)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = []
    let scannedCount = 0
    for (let i = 0; i < scanned.length; i += POOL) {
      if (expected > 0 && rows.length >= expected) break
      const batch = scanned.slice(i, i + POOL)
      scannedCount += batch.length
      const details = await Promise.all(
        batch.map((c) => getDocumentDetailCached(c.format, c.number, c.date.slice(0, 4)).catch(() => null))
      )
      details.forEach((doc, j) => {
        const c = batch[j]
        for (const l of doc?.lines || []) {
          if (normItem(l.item_code) !== want) continue
          rows.push({
            doc_format: c.format,
            doc_number: c.number,
            doc_date: String(doc.doc_date || c.date).slice(0, 10),
            line_number: l.line_number,
            quantity: l.quantity,
            unit_price: l.unit_price,
            discount_percent: l.discount_percent,
            line_total: l.line_total,
          })
        }
      })
    }
    rows.sort((a, b) => (b.doc_date || '').localeCompare(a.doc_date || ''))

    return NextResponse.json({
      item_code: itemCode,
      customer_code: code,
      days,
      scanned_docs: scannedCount,
      total_docs: candidates.length,
      capped,
      count: rows.length,
      rows,
    })
  } catch (error) {
    console.error('[customer item invoices]', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed', rows: [] },
      { status: 500 }
    )
  }
}
