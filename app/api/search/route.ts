import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { client } from '@/lib/finansit-client'
import { query } from '@/lib/db'

/**
 * Partly-catalog matches for codes the ERP can't find — above all TOYOTA
 * (SU0*) part ids, which exist only in partly.global_parts. Excludes codes
 * the ERP already knows (those surface in the regular items group).
 */
async function searchPartlyCatalog(q: string): Promise<any[]> {
  const like = q.toUpperCase().replace(/[%_]/g, '') + '%'
  const res = await query(
    `SELECT gp.item_number AS code, gp.brand, gp.description, gp.hebrew_description
     FROM partly.global_parts gp
     WHERE gp.item_number LIKE $1
       AND NOT EXISTS (SELECT 1 FROM erp.items e WHERE e.code = gp.item_number)
       AND NOT EXISTS (SELECT 1 FROM erp.items e WHERE e.code = 'MG' || gp.item_number)
     ORDER BY gp.item_number
     LIMIT 6`,
    [like]
  ).catch(() => null)
  return (res?.rows ?? []).map((r: any) => ({
    code: r.code,
    brand: r.brand || 'PSA',
    description: r.description || null,
    hebrewDescription: r.hebrew_description && r.hebrew_description !== '-' ? r.hebrew_description : null,
  }))
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 2) {
    return NextResponse.json({ items: [], customers: [], semantic: [], catalog: [] })
  }

  try {
    await initializeSecrets()

    // Determine if query looks like natural language (contains spaces, >3 chars)
    const isNaturalLanguage = q.length > 3 && q.includes(' ')

    const promises: [
      Promise<{ items: any[] }>,
      Promise<{ customers: any[] }>,
      Promise<{ items: any[] }> | null,
    ] = [
      client.items.search(q, 5).catch(() => ({ items: [] })),
      client.customers.search(q, 5).catch(() => ({ customers: [] })),
      isNaturalLanguage
        ? client.items.semanticSearch(q, 5).catch(() => ({ items: [] }))
        : null,
    ]

    const results = await Promise.all(
      promises.filter((p): p is NonNullable<typeof p> => p !== null)
    )

    const itemsResult = results[0] as { items: any[] }
    const customersResult = results[1] as { customers: any[] }
    const semanticResult = isNaturalLanguage
      ? (results[2] as { items: any[] })
      : { items: [] }

    const items = (itemsResult.items || itemsResult || []).slice(0, 5)
    const customers = (customersResult.customers || customersResult || []).slice(0, 5)
    const semantic = (semanticResult.items || []).slice(0, 5)
    const catalog = await searchPartlyCatalog(q)

    return NextResponse.json({ items, customers, semantic, catalog })
  } catch (error) {
    console.error('[API /search] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    )
  }
}
