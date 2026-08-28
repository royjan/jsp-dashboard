import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { client } from '@/lib/finansit-client'
import { query } from '@/lib/db'
import { getCached, setCache } from '@/lib/redis-client'

const SEARCH_CACHE_TTL = 60

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

/**
 * A name that carries no letters is a cross-reference number that landed in the
 * name column, not a name. 1920LL is stored as "0821495761".
 */
function looksLikeACode(name: unknown): boolean {
  return typeof name !== 'string' || !/\p{L}/u.test(name)
}

/**
 * Fill in what FINAPI's item search leaves out.
 *
 * `/api/items/search` returns the raw ERP row, and for a superseded code that
 * row is nearly empty: 1920LL comes back named "0821495761" with null stock and
 * null price, because the descriptive name ("מש לחץ גבוהה") and the four on the
 * shelf live on the canonical code at the end of its supersession chain,
 * 1675941280. `/api/items/{code}` folds that chain; search does not. ⌘K was
 * rendering the unfolded row faithfully -- a number, a second number, and
 * "Stock:" with nothing after it.
 *
 * stock.batch folds the chain and names the canonical code, so one batch call
 * per search buys both the quantity and the code whose name is worth showing;
 * prices.batch buys the price the same way; and one query against erp.items
 * turns those canonical codes into names. The same three calls the semantic
 * half of this search already makes -- the two halves now arrive equally
 * furnished, which is the whole point of merging them into one palette.
 */
async function enrichItems(items: any[]): Promise<any[]> {
  const codes = items.map((i) => i?.code).filter(Boolean).map(String)
  if (!codes.length) return items

  const [stockResult, priceResult] = await Promise.all([
    client.stock.batch(codes).catch(() => ({ items: [] as any[] })),
    client.prices.batch({ item_codes: codes, include_stock: false }).catch(() => ({ items: [] as any[] })),
  ])

  const stockByCode = new Map<string, any>()
  for (const s of (stockResult.items || [])) {
    if (s?.item_code) stockByCode.set(String(s.item_code).toUpperCase(), s)
  }

  const priceByCode = new Map<string, number>()
  for (const p of (priceResult.items || [])) {
    const code = String(p?.item_code || p?.code || '').toUpperCase()
    const price = p?.price ?? p?.price_list_price ?? null
    if (code && typeof price === 'number' && price > 0) priceByCode.set(code, price)
  }

  const canonicalCodes = [...new Set(
    codes
      .map((c) => stockByCode.get(c.toUpperCase())?.canonical_code)
      .filter(Boolean)
      .map(String)
  )]
  const nameByCode = new Map<string, string>()
  if (canonicalCodes.length) {
    const res = await query(
      `SELECT code, name FROM erp.items WHERE code = ANY($1::text[])`,
      [canonicalCodes]
    ).catch(() => null)
    for (const r of (res?.rows ?? [])) {
      if (r?.name) nameByCode.set(String(r.code), String(r.name))
    }
  }

  return items.map((item) => {
    const uc = String(item?.code ?? '').toUpperCase()
    const stock = stockByCode.get(uc)
    const canonical = stock?.canonical_code ? String(stock.canonical_code) : null
    // Only when the row's own name is not a name. A code that already reads as
    // one keeps it -- the canonical row is not automatically the better label.
    const canonicalName = canonical && canonical.toUpperCase() !== uc
      ? nameByCode.get(canonical)
      : undefined
    return {
      ...item,
      name: looksLikeACode(item?.name) && canonicalName ? canonicalName : item?.name,
      stock_qty: item?.stock_qty ?? stock?.total_qty ?? null,
      ordered_qty: item?.ordered_qty ?? stock?.total_ordered ?? null,
      incoming_qty: item?.incoming_qty ?? stock?.total_incoming ?? null,
      price: item?.price ?? priceByCode.get(uc) ?? null,
      canonical_code: canonical,
    }
  })
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim()
  if (!q || q.length < 2) {
    return NextResponse.json({ items: [], customers: [], semantic: [], catalog: [] })
  }

  // A minute, because this now costs four upstream calls and the palette fires
  // it per keystroke: typing a code walks "19", "192", "1920", "1920L" ... and
  // every backspace, every reopen and every second person searching the same
  // part re-walks it. Short enough that a quantity changing in the ERP shows up
  // in a search while you are still looking for it. The smart half has cached
  // for an hour all along; the two are asked together and only one was.
  const cacheKey = `search:v2:${q}`
  const cached = await getCached<{ items: unknown[]; customers: unknown[]; semantic: unknown[]; catalog: unknown[] }>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    await initializeSecrets()

    // Determine if query looks like natural language (contains spaces, >3 chars)
    const isNaturalLanguage = q.length > 3 && q.includes(' ')

    const promises: [
      Promise<{ items: any[] }>,
      Promise<{ customers: any[] }>,
      Promise<{ items: any[] }> | null,
    ] = [
      // 10, not 5: "1920L" matches thirteen codes in the ERP, and at five the
      // other eight fell off the list and came back through the semantic
      // endpoint, where they read as smart finds rather than as the plain code
      // matches they are. The list scrolls; the cap was the only thing making
      // consecutive codes look like different kinds of result.
      client.items.search(q, 10).catch(() => ({ items: [] })),
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

    const rawItems = (itemsResult.items || itemsResult || []).slice(0, 10)
    const customers = (customersResult.customers || customersResult || []).slice(0, 5)
    const semantic = (semanticResult.items || []).slice(0, 5)
    const [items, catalog] = await Promise.all([
      enrichItems(rawItems).catch(() => rawItems),
      searchPartlyCatalog(q),
    ])

    const payload = { items, customers, semantic, catalog }
    await setCache(cacheKey, payload, SEARCH_CACHE_TTL).catch(() => {})
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[API /search] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Search failed' },
      { status: 500 }
    )
  }
}
