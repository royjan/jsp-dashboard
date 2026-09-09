export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { fetchDocumentLinesSlow } from '@/lib/finansit-client'
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
    const unavailable: string[] = []

    const perCode = await Promise.all(
      codes.map((c) =>
        // NO FAILOVER, deliberately — finansit-client.ts already records why for
        // this endpoint: "the fallback box answers this endpoint with 503, so
        // failing over just converts a slow answer into an error." Here it did
        // something worse than an error. On supplier invoices (58) the primary
        // .111 answers 503 "No data source available", the shared client fails
        // over to .109, and .109 returns an empty envelope — so the 503 was
        // swallowed and the panel said ⁧לא נמצאו מסמכים⁩ about an item whose own
        // record shows a purchase on 3.3.2026. The 503 has to reach the catch
        // below to be told apart from a genuine absence.
        fetchDocumentLinesSlow({ item_code: c, doc_format, limit: 50 })
          .then((raw) => {
            const l: any[] = Array.isArray(raw) ? raw : (raw?.lines || raw?.documents || raw?.data || [])
            return l.map((line) => ({ line, source_code: c }))
          })
          // One dead alias must not blank the whole tab.
          .catch((e) => {
            // "No data source available for document lines" is FINAPI saying the
            // BULK tier is down, not that the item has no such documents. The two
            // read identically once they both become an empty array, and the panel
            // then says ⁧לא נמצאו מסמכים⁩ — which is a claim about the item, and
            // false. Live on 2026-09-09: every supplier-invoice (58) lookup answers
            // exactly that, while the item record still carries a purchase date.
            if (/no data source/i.test(String(e?.message ?? e))) unavailable.push(c)
            return [] as { line: any; source_code: string }[]
          }),
      ),
    )

    const seen = new Set<string>()
    const rows = perCode
      .flat()
      .map(({ line: l, source_code }) => ({
        // FINAPI CALLS IT `doc_num`. None of the three names tried here existed on
        // the payload, so this was `null` on every row: the מסמך column read "-"
        // for every line, and the de-dup below — which keys on it — had nothing
        // to key on. Verified against the live endpoint 2026-09-09:
        // {"doc_format":"31","doc_num":"332358","doc_date":"2026-09-06",...}.
        doc_number: l.doc_num ?? l.doc_number ?? l.document_number ?? l.number ?? null,
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
      // STEP 1 — drop the alias copies. FINAPI's item index answers ANY code in a
      // chain with the whole chain's lines, so asking under three codes returns
      // each line three times. `item_code` here is the code we ASKED under, not
      // the item on the line, so keying on it made this a no-op and one document
      // became three rows (live on 1920LL → 9819938480 → 1675941280).
      .filter((r) => {
        const k = `${r.doc_format}|${r.doc_number}|${r.date}|${r.qty}|${r.total}`
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })

    // STEP 2 — one row per DOCUMENT, which is what the column claims to be.
    // A document really can carry this part on more than one line: of 42 quotes
    // on 1675941280, eight do — 331318 holds 4,195.65 and 2,200; 319478 holds a
    // zeroed line and 3,400. Showing them as separate rows read as duplicated
    // documents, because the only visible difference was a masked amount. So
    // sum the money and the quantity, and say how many lines it came from —
    // hiding the second line would understate what the document is worth.
    const byDoc = new Map<string, (typeof rows)[number] & { lines: number }>()
    for (const r of rows) {
      // A document with no number cannot be merged on one, so keep it distinct
      // by date and party rather than collapsing unrelated rows together.
      const k = `${r.doc_format}|${r.doc_number ?? `~${r.date}|${r.party}`}`
      const cur = byDoc.get(k)
      if (!cur) {
        byDoc.set(k, { ...r, lines: 1 })
      } else {
        cur.qty += r.qty
        cur.total += r.total
        cur.lines += 1
      }
    }

    const merged = [...byDoc.values()]
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 50)

    // Only when the source failed for EVERY code and produced nothing: a partial
    // answer is an answer, and should not be flagged as an outage.
    const source_unavailable = merged.length === 0 && unavailable.length === codes.length
    return NextResponse.json({
      type, count: merged.length, rows: merged, chain_codes: codes, source_unavailable,
    })
  } catch (error) {
    console.error('[items/:code/documents] Error:', error)
    return NextResponse.json({ rows: [], error: error instanceof Error ? error.message : 'Failed' })
  }
}
