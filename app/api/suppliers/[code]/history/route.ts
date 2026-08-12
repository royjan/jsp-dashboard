export const maxDuration = 30

import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { initializeSecrets } from '@/lib/aws-secrets'

/**
 * Purchase history for one supplier, from the ERP documents already synced to
 * Neon. On a purchase document the "customer" IS the supplier.
 *
 * This replaced a tab that read `dashboard.supplier_order_confirmations` — a
 * manual workflow table that holds 0 rows for every supplier, so the tab was
 * empty for everyone, not just the supplier that prompted the question.
 *
 * 62 = in-transit / goods received, 58 = purchase invoice. Open orders (61)
 * are deliberately excluded — those are the "pending" view.
 */
const FORMAT_LABEL: Record<string, { he: string; en: string }> = {
  '62': { he: 'תעודת משלוח', en: 'Delivery note' },
  '58': { he: 'חשבונית רכש', en: 'Purchase invoice' },
  '61': { he: 'הזמנת רכש', en: 'Purchase order' },
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    await initializeSecrets()
    const { code } = await params

    const res = await query(
      `SELECT year, format, doc_number, doc_date::text AS doc_date,
              COALESCE(status, '') AS status,
              COALESCE(grand_total, 0) AS grand_total,
              COALESCE(total, 0) AS total
         FROM dashboard.documents
        WHERE customer_code = $1 AND format IN ('62','58')
        ORDER BY doc_date DESC NULLS LAST, doc_number DESC
        LIMIT 300`,
      [code],
    )

    const documents = res.rows.map((r: Record<string, unknown>) => ({
      year: r.year,
      format: r.format,
      formatLabel: FORMAT_LABEL[String(r.format)] ?? { he: String(r.format), en: String(r.format) },
      docNumber: r.doc_number,
      docDate: r.doc_date,
      status: r.status,
      // NUMERIC arrives as a JS number (parsers registered in lib/db.ts), but
      // coerce anyway so a missing parser can never turn `+` into concatenation.
      grandTotal: Number(r.grand_total) || 0,
      total: Number(r.total) || 0,
    }))

    const summary = {
      documents: documents.length,
      deliveryNotes: documents.filter((d) => d.format === '62').length,
      invoices: documents.filter((d) => d.format === '58').length,
      totalValue: documents.reduce((s, d) => s + d.grandTotal, 0),
      lastDocument: documents[0]?.docDate ?? null,
    }

    return NextResponse.json({ documents, summary })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed', documents: [] },
      { status: 500 },
    )
  }
}
