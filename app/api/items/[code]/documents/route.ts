export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { fetchDocumentLines } from '@/lib/finansit-client'
import { DOC_FORMATS } from '@/lib/constants'
import { itemChainCodes } from '@/lib/services/analytics-service'

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

    // Ask for EVERY code in the supersession chain, not just the one in the URL.
    // Documents are filed against whatever code was current on the day, so the
    // canonical code alone hides the part's own history: 22,267 lines sit on
    // 1,946 superseded codes catalogue-wide — /items/1675941280 showed 346
    // quotes and hid the 21 filed under 1920LL and 9819938480.
    const requested = decodeURIComponent(code)
    const codes = await itemChainCodes(requested)

    const perCode = await Promise.all(
      codes.map((c) =>
        fetchDocumentLines({ item_code: c, doc_format, limit: 50 })
          .then((raw) => {
            const l: any[] = Array.isArray(raw) ? raw : (raw?.lines || raw?.documents || raw?.data || [])
            return l.map((line) => ({ line, source_code: c }))
          })
          // One dead alias must not blank the whole tab.
          .catch(() => [] as { line: any; source_code: string }[]),
      ),
    )

    const seen = new Set<string>()
    const rows = perCode
      .flat()
      .map(({ line: l, source_code }) => ({
        doc_number: l.doc_number ?? l.document_number ?? l.number ?? null,
        doc_format,
        date: l.doc_date ?? l.date ?? '',
        party: l.customer_name ?? l.supplier_name ?? l.customer_code ?? '',
        qty: Number(l.quantity ?? l.qty ?? 0) || 0,
        unit_price: Number(l.unit_price ?? l.price ?? 0) || 0,
        total: Number(l.line_total ?? l.total ?? l.sum ?? 0) || 0,
        // Which code in the chain this line was filed under; the UI can show it
        // when it differs from the code being viewed.
        item_code: source_code,
      }))
      // The same document can come back from two codes when it listed both.
      .filter((r) => {
        const k = `${r.doc_number}|${r.item_code}|${r.qty}|${r.total}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 50)

    return NextResponse.json({ type, count: rows.length, rows, chain_codes: codes })
  } catch (error) {
    console.error('[items/:code/documents] Error:', error)
    return NextResponse.json({ rows: [], error: error instanceof Error ? error.message : 'Failed' })
  }
}
