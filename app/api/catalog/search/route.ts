import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'

/**
 * GET /api/catalog/search?q=<text>[&exclude=<code>][&limit=8]
 *
 * Candidate parts to LINK to, typed ahead. Searches partly.global_parts by code prefix,
 * English description and Hebrew description, and reports whether each is sellable in the ERP.
 *
 * Distinct from /api/search's catalog group, which deliberately EXCLUDES codes the ERP already
 * knows (there they'd be noise, duplicating the items group). Here the opposite is right: a
 * link target only has to exist in partly's catalog, and most equivalents ARE stocked codes.
 *
 * Why this endpoint exists at all: linking used to be a bare text box, so you could type a code
 * that isn't in the catalog — e.g. 1920LL, a real erp.items code with no partly row — and only
 * learn it was unlinkable after submitting. Picking from real rows makes that unrepresentable.
 */

export interface CatalogHit {
  code: string
  brand: 'PSA' | 'MG' | 'TOYOTA' | string
  description: string | null
  hebrewDescription: string | null
  /** true = we can sell it (erp.items, with or without the MG prefix the ERP adds) */
  inErp: boolean
}

const MAX_LIMIT = 20

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  const exclude = request.nextUrl.searchParams.get('exclude')?.trim().toUpperCase() ?? ''
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') ?? '8', 10) || 8)
  )
  if (q.length < 2) return NextResponse.json({ hits: [] })

  try {
    await initializeSecrets()
    // strip LIKE wildcards so a stray % can't turn the prefix scan into a full scan
    const code = q.toUpperCase().replace(/[%_]/g, '')
    const text = q.replace(/[%_]/g, '')

    const res = await query(
      `SELECT gp.item_number AS code, gp.brand, gp.description, gp.hebrew_description,
              EXISTS (SELECT 1 FROM erp.items e
                      WHERE e.code = gp.item_number OR e.code = 'MG' || gp.item_number) AS in_erp
       FROM partly.global_parts gp
       WHERE (gp.item_number LIKE $1 OR gp.description ILIKE $2 OR gp.hebrew_description ILIKE $2)
         AND ($3 = '' OR gp.item_number <> $3)
       ORDER BY (gp.item_number = $4) DESC,          -- exact code first
                (gp.item_number LIKE $1) DESC,       -- then code prefix
                length(coalesce(gp.description, '')),
                gp.item_number
       LIMIT $5`,
      [`${code}%`, `%${text}%`, exclude, code, limit]
    ).catch(() => null)

    const hits: CatalogHit[] = (res?.rows ?? []).map((r: any) => ({
      code: r.code,
      brand: r.brand || 'PSA',
      description: r.description || null,
      // '-' is partly's placeholder for "no Hebrew description"
      hebrewDescription:
        r.hebrew_description && r.hebrew_description !== '-' ? r.hebrew_description : null,
      inErp: Boolean(r.in_erp),
    }))

    return NextResponse.json({ hits })
  } catch (error) {
    console.warn('[catalog/search] failed:', error instanceof Error ? error.message : error)
    // Never break the typeahead — an empty list degrades to the free-text fallback.
    return NextResponse.json({ hits: [] })
  }
}
