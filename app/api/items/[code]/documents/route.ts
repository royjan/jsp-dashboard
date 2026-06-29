export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { fetchDocumentLines } from '@/lib/finansit-client'
import { DOC_FORMATS } from '@/lib/constants'

// Drill-down for an item card: the documents an item appears in, by type.
// invoices=11 (tax invoice), quotes=31 (price quote), purchases=58 (supplier invoice).
const TYPE_FORMAT: Record<string, string> = {
  invoices: String(DOC_FORMATS.TAX_INVOICE),
  quotes: String(DOC_FORMATS.QUOTE),
  purchases: '58',
}

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    await initializeSecrets()
    const { code } = await params
    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') || 'invoices'
    const doc_format = TYPE_FORMAT[type] || TYPE_FORMAT.invoices

    const raw = await fetchDocumentLines({
      item_code: decodeURIComponent(code),
      doc_format,
      limit: 50,
    })
    const lines: any[] = Array.isArray(raw) ? raw : (raw?.lines || raw?.documents || raw?.data || [])

    const rows = lines
      .map((l: any) => ({
        doc_number: l.doc_number ?? l.document_number ?? l.number ?? null,
        doc_format,
        date: l.doc_date ?? l.date ?? '',
        party: l.customer_name ?? l.supplier_name ?? l.customer_code ?? '',
        qty: Number(l.quantity ?? l.qty ?? 0) || 0,
        unit_price: Number(l.unit_price ?? l.price ?? 0) || 0,
        total: Number(l.line_total ?? l.total ?? l.sum ?? 0) || 0,
      }))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))

    return NextResponse.json({ type, count: rows.length, rows })
  } catch (error) {
    console.error('[items/:code/documents] Error:', error)
    return NextResponse.json({ rows: [], error: error instanceof Error ? error.message : 'Failed' })
  }
}
