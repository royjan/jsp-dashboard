import { NextResponse } from 'next/server'
import { pickQueue, stockDisputes, shippingHistory, splitDocumentNumber, PICK_QUEUE_LIMIT, InvagentUnavailable } from '@/lib/invagent'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * The picking floor: what is still being picked, what pickers could not find,
 * and what shipped.
 *
 * Server-side on purpose — the Supabase service_role key never reaches the
 * browser, and the anon key cannot substitute for it (RLS returns an empty
 * array rather than a 403, which would render as an idle warehouse).
 *
 * A source that could not be consulted answers 503 with `sourceAvailable:
 * false`, never 200 with empty arrays. The page renders that as an outage.
 */
interface DocRef {
  format: string
  docNumber: string
  year: string | null
  customerCode: string | null
  customerName: string | null
}

/**
 * `doc_date` arrives as a Date, not a string — lib/db registers a DATE parser.
 * `String(new Date())` is "Tue Feb 10 2026 …", whose first four characters are
 * "Tue ", so slicing a year off it produces a `?year=Tue` that the document API
 * quietly ignores.
 */
function yearOf(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return String(value.getUTCFullYear())
  const s = String(value)
  return /^\d{4}/.test(s) ? s.slice(0, 4) : null
}

/**
 * What invagent cannot tell us about its own documents.
 *
 * The picking app knows a customer's NAME and nothing else, and /customers/[code]
 * needs the code. Matching those names against ERP customers is the fuzzy join
 * that has produced wrong answers in this repo before, so resolve by DOCUMENT
 * instead — `pick_orders.document_number` IS the ERP document, which makes the
 * lookup exact.
 *
 * Enrichment only. Whatever does not resolve stays unlinked plain text; nothing
 * here may invent a code, and a lookup failure must not cost the caller the
 * picking data it already has.
 */
async function erpDocuments(documentNumbers: string[]): Promise<Map<string, DocRef>> {
  const out = new Map<string, DocRef>()
  const refs = documentNumbers
    .map(n => ({ raw: n, ref: splitDocumentNumber(n) }))
    .filter((x): x is { raw: string; ref: { format: string; number: string } } => x.ref !== null)
  if (!refs.length) return out

  // The date bound is what makes this cheap, and it is not cosmetic: every index
  // on this table leads with `year` or `(format, doc_date)`, and `year` is the
  // ERP's working-file partition rather than a calendar year, so it cannot be
  // derived from a document number. Without the bound the planner reads all
  // 195k format-11/19 rows (327ms measured); with it, 13ms. Three years is far
  // past anything that can still be on a picking floor, and a document older
  // than that simply stays unlinked rather than wrong.
  //
  // Two ANY() lists rather than a composite key, since no index covers
  // (format, doc_number); the cross-product over-match is filtered out by the
  // exact key below.
  const res = await query(
    `SELECT format, doc_number, customer_code, customer_name, doc_date
       FROM dashboard.documents
      WHERE format = ANY($2::text[])
        AND doc_date >= (CURRENT_DATE - interval '3 years')
        AND doc_number = ANY($1::text[])`,
    [
      [...new Set(refs.map(r => r.ref.number))],
      [...new Set(refs.map(r => r.ref.format))],
    ],
  )
  interface DocRow {
    format: string
    doc_number: string
    customer_code: string | null
    customer_name: string | null
    doc_date: unknown
  }
  const byKey = new Map<string, DocRow>(
    (res.rows as DocRow[]).map(r => [`${r.format}${r.doc_number}`, r]),
  )

  for (const { raw, ref } of refs) {
    const row = byKey.get(`${ref.format}${ref.number}`)
    out.set(raw, {
      format: ref.format,
      docNumber: ref.number,
      year: yearOf(row?.doc_date),
      customerCode: row?.customer_code || null,
      customerName: row?.customer_name || null,
    })
  }
  return out
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from') || undefined
  const to = searchParams.get('to') || undefined

  try {
    const [queue, disputes, shipped] = await Promise.all([
      pickQueue(),
      stockDisputes(from),
      shippingHistory(from, to),
    ])

    // A failure here costs the links, not the page.
    let docs = new Map<string, DocRef>()
    try {
      docs = await erpDocuments([
        ...queue.map(o => o.document_number),
        ...shipped.orders.map(o => o.document_number),
      ])
    } catch (e) {
      console.warn('[picking] ERP document lookup failed, rows stay unlinked:', e instanceof Error ? e.message : e)
    }
    const link = (n: string) => docs.get(n) ?? null

    return NextResponse.json({
      sourceAvailable: true,
      queue: queue.map(o => ({ ...o, doc: link(o.document_number) })),
      // The queue is capped, so its length is a floor and not a count — say so
      // rather than letting a page print it as "this is what is on the floor".
      queueCapped: queue.length >= PICK_QUEUE_LIMIT,
      disputes,
      shipped: {
        ...shipped,
        orders: shipped.orders.map(o => ({ ...o, doc: link(o.document_number) })),
      },
    })
  } catch (error) {
    if (error instanceof InvagentUnavailable) {
      // The cause goes to the log, where whoever can fix it is looking. The
      // response carries only what a warehouse user can do something with —
      // and never the name of a missing secret.
      console.warn('[picking] invagent unavailable:', error.message)
      return NextResponse.json(
        { sourceAvailable: false, reason: error.userMessage },
        { status: 503 },
      )
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch picking data' },
      { status: 500 },
    )
  }
}
