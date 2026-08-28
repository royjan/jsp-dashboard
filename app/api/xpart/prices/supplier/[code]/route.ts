export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import {
  getSupplierCatalog,
  getSupplierCatalogSummary,
  resolveXpartSupplierCode,
  type SupplierCatalogSort,
} from '@/lib/xpart/prices'
import { resolveItemNames } from '@/lib/services/analytics-service'
import type { Provenance } from '@/lib/provenance'

const SORTS: SupplierCatalogSort[] = [
  'item_code',
  'price',
  'landed_ils',
  'retail_ils',
  'margin_pct',
  'cheaper_elsewhere_ils',
]

/**
 * GET /api/xpart/prices/supplier/[code]
 *
 * One supplier's priced catalog. `code` is the ERP supplier code (the same one
 * /suppliers/[code] uses); it is translated to Xpart's own supplier code here so
 * callers never have to know Xpart's numbering.
 *
 * Item names are resolved through FINAPI for the visible page only — the whole
 * catalog can be 65k rows, and naming all of them would cost hundreds of ERP
 * round-trips to fill a screen showing a hundred.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    await initializeSecrets()
    const { code } = await params
    const erpCode = decodeURIComponent(code || '').trim()
    const { searchParams } = new URL(req.url)

    const xpartCode = await resolveXpartSupplierCode(erpCode)
    if (!xpartCode) {
      // Not an error: most ERP suppliers simply have no Xpart price list.
      return NextResponse.json({
        supplierCode: erpCode,
        linked: false,
        rows: [],
        total: 0,
        summary: null,
        provenance: {
          source: 'unavailable',
          reason: 'לספק זה אין מחירון ב‑Xpart',
        } satisfies Provenance,
      })
    }

    const sortParam = searchParams.get('sort') as SupplierCatalogSort | null
    const sort = sortParam && SORTS.includes(sortParam) ? sortParam : 'landed_ils'
    const limit = Number(searchParams.get('limit') ?? 100)
    const offset = Number(searchParams.get('offset') ?? 0)

    const [{ rows, total }, summary] = await Promise.all([
      getSupplierCatalog(xpartCode, {
        search: searchParams.get('q') ?? undefined,
        sort,
        dir: searchParams.get('dir') === 'asc' ? 'asc' : 'desc',
        limit,
        offset,
        onlyCheaperElsewhere: searchParams.get('cheaper') === '1',
      }),
      getSupplierCatalogSummary(xpartCode),
    ])

    let names = new Map<string, string>()
    try {
      names = await resolveItemNames(rows.map(r => r.item_code))
    } catch {
      // FINAPI is LAN-only; off-network the codes stand on their own.
    }

    return NextResponse.json({
      supplierCode: erpCode,
      xpartSupplierCode: xpartCode,
      linked: true,
      rows: rows.map(r => ({ ...r, item_name: names.get(r.item_code.toUpperCase()) ?? null })),
      total,
      summary,
      provenance: {
        source: 'postgres',
        rows: total,
        scope: 'מחירון הספק ב‑Xpart',
        asOf: rows.map(r => r.effective_date).filter(Boolean).sort().at(-1) ?? undefined,
      } satisfies Provenance,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}
