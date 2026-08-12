export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { searchItems, searchCustomers } from '@/lib/finansit-client'
import { getCached, setCache } from '@/lib/redis-client'

/**
 * Lean type-ahead lookup for the sales-rep screens: one entity kind, one
 * upstream call, nothing else.
 *
 * Deliberately not /api/search — that one fans out to items, customers,
 * semantic search AND the partly catalog on every keystroke, and a cold call
 * measured ~30s. A picker firing per character needs the narrow query.
 */
const TTL_SECONDS = 10 * 60

export interface LookupHit {
  code: string
  name: string
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const q = (searchParams.get('q') || '').trim()
    const kind = searchParams.get('kind') === 'customer' ? 'customer' : 'item'
    const limit = Math.min(Number(searchParams.get('limit')) || 8, 20)

    // Below two characters every query matches half the catalogue; not worth a
    // round trip, and the UI does not open the list either.
    if (q.length < 2) return NextResponse.json({ hits: [] })

    const cacheKey = `lookup:${kind}:v1:${q.toLowerCase()}:${limit}`
    const cached = await getCached<LookupHit[]>(cacheKey)
    if (cached) return NextResponse.json({ hits: cached, cached: true })

    await initializeSecrets()

    // searchItems takes no limit — it is capped client-side below.
    const raw = kind === 'customer' ? await searchCustomers(q, limit) : await searchItems(q)

    const hits: LookupHit[] = (raw || []).slice(0, limit).map((r: Record<string, unknown>) => ({
      code: String(r.code ?? r.item_code ?? r.customer_code ?? ''),
      name: String(r.name ?? r.item_name ?? r.customer_name ?? ''),
    })).filter((h) => h.code)

    await setCache(cacheKey, hits, TTL_SECONDS)
    return NextResponse.json({ hits })
  } catch (error) {
    // A failed lookup must never block typing — the field still submits free
    // text, and the price-check call gives the authoritative answer.
    console.warn('[sales-rep/lookup]', error instanceof Error ? error.message : error)
    return NextResponse.json({ hits: [] })
  }
}
