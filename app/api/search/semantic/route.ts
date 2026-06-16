import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { client } from '@/lib/finansit-client'
import { getCached, setCache } from '@/lib/redis-client'

interface EnrichedSemanticResult {
  code: string
  name: string
  similarity: number
  price: number | null
  stock_qty: number | null
  ordered_qty: number | null
  incoming_qty: number | null
}

const CACHE_TTL = 60 * 60 // 1 hour

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim()
  const limitParam = request.nextUrl.searchParams.get('limit')
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 50) : 20

  if (!q || q.length < 2) {
    return NextResponse.json({ query: '', items: [], count: 0 })
  }

  try {
    await initializeSecrets()

    // Check Redis cache
    const cacheKey = `semantic:${q}:${limit}`
    const cached = await getCached<{ query: string; items: EnrichedSemanticResult[]; count: number }>(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    // Call semantic search via SDK
    const semanticResult = await client.items.semanticSearch(q, limit)
    const items = semanticResult.items || []

    if (items.length === 0) {
      const empty = { query: q, items: [], count: 0 }
      await setCache(cacheKey, empty, CACHE_TTL)
      return NextResponse.json(empty)
    }

    // Batch enrich with stock and price data
    const codes = items.map((i: any) => i.code)

    const [stockResult, priceResult] = await Promise.all([
      client.stock.batch(codes).catch(() => ({ items: [] as any[] })),
      client.prices.batch({ item_codes: codes, include_stock: false }).catch(() => ({ items: [] as any[] })),
    ])

    const stockMap = new Map<string, { total_qty: number | null; total_ordered: number | null; total_incoming: number | null }>()
    for (const s of (stockResult.items || [])) {
      stockMap.set(s.item_code?.toUpperCase(), {
        total_qty: s.total_qty ?? null,
        total_ordered: s.total_ordered ?? null,
        total_incoming: s.total_incoming ?? null,
      })
    }

    const priceMap = new Map<string, number>()
    for (const p of (priceResult.items || [])) {
      const code = (p.item_code || p.code || '').toUpperCase()
      const price = p.price ?? p.price_list_price ?? 0
      if (code && price > 0) priceMap.set(code, price)
    }

    // Merge results
    const enriched: EnrichedSemanticResult[] = items.map((item: any) => {
      const uc = item.code.toUpperCase()
      const stock = stockMap.get(uc)
      return {
        code: item.code,
        name: item.name,
        similarity: item.similarity,
        price: priceMap.get(uc) ?? null,
        stock_qty: stock?.total_qty ?? null,
        ordered_qty: stock?.total_ordered ?? null,
        incoming_qty: stock?.total_incoming ?? null,
      }
    })

    const result = { query: q, items: enriched, count: enriched.length }

    // Cache for 1 hour
    await setCache(cacheKey, result, CACHE_TTL)

    return NextResponse.json(result)
  } catch (error) {
    console.error('[API /search/semantic] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Semantic search failed' },
      { status: 500 }
    )
  }
}
