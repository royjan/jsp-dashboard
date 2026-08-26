export const maxDuration = 60

import { NextResponse } from 'next/server'
import { fetchDocuments } from '@/lib/finansit-client'
import { getCached, setCache } from '@/lib/redis-client'
import { initializeSecrets } from '@/lib/aws-secrets'
import type { Provenance } from '@/lib/provenance'

/**
 * Supplier credits (זיכוי ספק).
 *
 * There is no supplier-credit format in Finansit. A credit is a FORMAT 51
 * document — חשבונית מספק בארץ — with a NEGATIVE total. That is the whole
 * definition, and it is why an agent that looked for the existence of a 51 and
 * reported "no credit found" was structurally unable to find one.
 *
 * Two traps this route exists to avoid, both of which have bitten before:
 *
 * 1. QUOTE grand_total, NOT total. `total` is pre-VAT. A domestic 51 carries
 *    18% VAT despite the schema's VAT=0 note, which applies to the FOREIGN
 *    supplier formats (32/52/58). Reporting `total` understates every credit by
 *    18% — one real credit is -1,062.46 pre-VAT against -1,253.69 including it.
 *
 * 2. NEVER filter the ERP by date for a "recent" question. Dates disable both
 *    fast paths in FINAPI (`is_latest_of_format` needs no dates; the indexed
 *    customer lookup needs no `date_to`), dropping the query to a full 7IVH scan
 *    because IvhDate has no index. Measured: 0.50s without dates vs 1.15s with,
 *    and on format 31 the same shape is a 1,960-second disaster. So: pull the
 *    newest N of the format and filter for negatives in JS.
 *
 * Format 12 is deliberately NOT included — that is a CUSTOMER credit
 * (חשבונית מס זיכוי), a receivable, and mixing it in would double-count money
 * moving in the opposite direction.
 */

const CACHE_KEY = 'analytics:supplier-credits:v1'
const TTL_SECONDS = 30 * 60

/** How many recent format-51 documents to scan for negatives. */
const SCAN_DEPTH = 300

export interface SupplierCredit {
  doc_number: string
  doc_date: string | null
  supplier_code: string | null
  supplier_name: string | null
  /** Including VAT. This is the number to quote. */
  grand_total: number
  /** Pre-VAT, kept only so the difference is inspectable. */
  total: number
}

export async function GET() {
  try {
    await initializeSecrets()

    const cached = await getCached<unknown>(CACHE_KEY)
    if (cached) return NextResponse.json(cached)

    // No date filter, by design — see the note above.
    const docs = await fetchDocuments(51, SCAN_DEPTH)

    const credits: SupplierCredit[] = docs
      .map((d: Record<string, unknown>) => {
        // Prefer grand_total; fall back to total only so a missing field shows
        // up as a smaller number rather than as a dropped credit.
        const grand = Number(d.grand_total ?? d.total ?? 0)
        return {
          doc_number: String(d.doc_number ?? ''),
          doc_date: (d.doc_date as string) ?? null,
          supplier_code: (d.customer_code as string) ?? null,
          supplier_name: (d.customer_name as string) ?? null,
          grand_total: grand,
          total: Number(d.total ?? 0),
        }
      })
      .filter(c => c.grand_total < 0)
      .sort((a, b) => (b.doc_date ?? '').localeCompare(a.doc_date ?? ''))

    const missingGrandTotal = docs.filter(
      (d: Record<string, unknown>) => d.grand_total === undefined || d.grand_total === null,
    ).length

    const body = {
      credits,
      scanned: docs.length,
      totalCredited: credits.reduce((s, c) => s + Math.abs(c.grand_total), 0),
      provenance: {
        source: 'finapi',
        asOf: new Date().toISOString(),
        rows: credits.length,
        // The scan depth IS the honest limit here: a credit older than the last
        // SCAN_DEPTH format-51 documents is not in this list, and saying so
        // beats implying the list is every credit ever issued.
        truncated: docs.length >= SCAN_DEPTH,
        scope: `${docs.length} מסמכי פורמט 51 אחרונים${
          missingGrandTotal ? ` · ${missingGrandTotal} ללא grand_total (הוחלף ב-total)` : ''
        }`,
      } satisfies Provenance,
    }

    await setCache(CACHE_KEY, body, TTL_SECONDS)
    return NextResponse.json(body)
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'error',
        provenance: {
          source: 'unavailable',
          reason: 'FINAPI לא החזיר מסמכי פורמט 51',
        } satisfies Provenance,
      },
      { status: 503 },
    )
  }
}
