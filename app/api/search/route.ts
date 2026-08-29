import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { client } from '@/lib/finansit-client'
import { query } from '@/lib/db'
import { getCached, setCache } from '@/lib/redis-client'
import { erpCodeViaSupersession } from '@/lib/partly-codes'

const SEARCH_CACHE_TTL = 60

/**
 * Partly-catalog matches for codes the ERP can't find — above all TOYOTA
 * (SU0*) part ids, which exist only in partly.global_parts. Excludes codes
 * the ERP already knows (those surface in the regular items group).
 */
interface CatalogHit {
  code: string
  brand: string
  description: string | null
  hebrewDescription: string | null
  /** The code we actually stock this catalog number under, if the chain names one. */
  erpCode: string | null
  erpVia: 'supersession' | null
}

async function searchPartlyCatalog(q: string): Promise<CatalogHit[]> {
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
  // A catalog-only code is a dead end on its own — description, no stock, no
  // price. But the catalog also says which code it replaced, and that one we
  // may well hold: this car's headlamp is catalogued as 1685352480 while the
  // four on the shelf sit under 1608206680 -> 1609697280. Resolve it here so
  // the customer's number reaches the part rather than a description.
  const catalogRows = (res?.rows ?? []) as Array<{
    code: string
    brand: string | null
    description: string | null
    hebrew_description: string | null
  }>
  const erpCodes = await Promise.all(
    catalogRows.map((r) => erpCodeViaSupersession(String(r.code)).catch(() => null)),
  )

  return catalogRows.map((r, i) => ({
    code: r.code,
    brand: r.brand || 'PSA',
    description: r.description || null,
    hebrewDescription: r.hebrew_description && r.hebrew_description !== '-' ? r.hebrew_description : null,
    erpCode: erpCodes[i],
    erpVia: erpCodes[i] ? ('supersession' as const) : null,
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
 * PSA prints a part id in groups -- "16 082 066 80" on the box, "16-082-066-80"
 * in a supplier's price list -- and the ERP stores it closed up: 1608206680.
 * Neither printed form found anything, because FINAPI's item search is a
 * substring match and the separators are part of the string it compares.
 *
 * So a query that reads as a separated code is searched twice: verbatim first
 * (codes really do carry dashes -- MG10929808-SEPP -- and those hits stay on
 * top), then with the separators removed. Returns null when the query is not
 * that: without the "plain alphanumerics, at least one digit" test, "משאבת מים"
 * would collapse into one word and be searched as it.
 */
function separatorlessCode(q: string): string | null {
  const stripped = q.replace(/[\s.\-/_\\]+/g, '')
  if (stripped === q || stripped.length < 3) return null
  if (!/^[A-Za-z0-9]+$/.test(stripped) || !/\d/.test(stripped)) return null
  return stripped
}

/** Concatenates result groups in order, keeping the first row per code. */
function mergeByCode<T extends { code?: unknown }>(...groups: T[][]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const group of groups) {
    for (const row of group) {
      const code = String(row?.code ?? '').toUpperCase()
      if (code) {
        if (seen.has(code)) continue
        seen.add(code)
      }
      out.push(row)
    }
  }
  return out
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
  const cacheKey = `search:v4:${q}`
  const cached = await getCached<{ items: unknown[]; customers: unknown[]; semantic: unknown[]; catalog: unknown[] }>(cacheKey)
  if (cached) return NextResponse.json(cached)

  try {
    await initializeSecrets()

    // Determine if query looks like natural language (contains spaces, >3 chars)
    const isNaturalLanguage = q.length > 3 && q.includes(' ')
    // "16 082 066 80" -> "1608206680", searched as a second pass under the
    // verbatim hits. null for everything that isn't a separated code.
    const closedUp = separatorlessCode(q)

    const [itemsResult, customersResult, semanticResult, closedUpResult] = await Promise.all([
      // 10, not 5: "1920L" matches thirteen codes in the ERP, and at five the
      // other eight fell off the list and came back through the semantic
      // endpoint, where they read as smart finds rather than as the plain code
      // matches they are. The list scrolls; the cap was the only thing making
      // consecutive codes look like different kinds of result.
      client.items.search(q, 10).catch(() => ({ items: [] as any[] })),
      client.customers.search(q, 5).catch(() => ({ customers: [] as any[] })),
      isNaturalLanguage
        ? client.items.semanticSearch(q, 5).catch(() => ({ items: [] as any[] }))
        : Promise.resolve({ items: [] as any[] }),
      closedUp
        ? client.items.search(closedUp, 10).catch(() => ({ items: [] as any[] }))
        : Promise.resolve({ items: [] as any[] }),
    ])

    const rawItems = mergeByCode(
      (itemsResult.items || itemsResult || []) as any[],
      (closedUpResult.items || []) as any[]
    ).slice(0, 10)
    const customers = (customersResult.customers || customersResult || []).slice(0, 5)
    const semantic = (semanticResult.items || []).slice(0, 5)
    const catalog = closedUp
      ? await Promise.all([searchPartlyCatalog(q), searchPartlyCatalog(closedUp)]).then(
          ([verbatim, stripped]) => mergeByCode(verbatim, stripped).slice(0, 6)
        )
      : await searchPartlyCatalog(q)

    // A code the catalog resolved into the ERP belongs in `items`, not only as
    // a footnote on the catalog hit: enrichItems folds its supersession chain
    // through stock.batch, so it arrives with the real quantity, price and the
    // canonical code — which is the whole answer the customer asked for.
    // mergeByCode keeps the ERP search's own hits on top and dedupes.
    const resolvedFromCatalog = [
      ...new Set(catalog.map((c) => c.erpCode).filter(Boolean).map(String)),
    ]
      .filter(
        (code) =>
          !rawItems.some(
            (i: { code?: unknown }) => String(i?.code ?? '').toUpperCase() === code.toUpperCase()
          )
      )
      .map((code) => ({ code }))

    const enriched = await enrichItems(
      mergeByCode(rawItems, resolvedFromCatalog).slice(0, 10)
    ).catch(() => rawItems)

    // enrichItems names a row from its CANONICAL code, so a resolved code that
    // is already its own canonical comes back nameless. The catalog knows what
    // the part is; a row with a quantity and no name is worse than either.
    const catalogNameByErpCode = new Map<string, string>()
    for (const c of catalog) {
      const label = c.hebrewDescription || c.description
      if (c.erpCode && label) catalogNameByErpCode.set(String(c.erpCode).toUpperCase(), String(label))
    }
    const items = enriched.map((it: { code?: unknown; name?: unknown }) =>
      String(it?.name ?? '').trim()
        ? it
        : { ...it, name: catalogNameByErpCode.get(String(it?.code ?? '').toUpperCase()) ?? it?.name }
    )

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
