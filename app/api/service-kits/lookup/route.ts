export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { fetchItemsBatch } from '@/lib/finansit-client'
import { whoIs } from '@/lib/service-kits-server'

/**
 * GET /api/service-kits/lookup?codes=000535HTC,469930G -> { items: { CODE: {name, stock_qty, incoming_qty, price} | null } }
 *
 * Name, stock and price of the fluid codes, from FINAPI (one batch call). An unknown code comes back null, so the
 * page can say "לא נמצא ב-ERP" next to a typo before the bot ever offers it.
 */
export async function GET(req: NextRequest) {
  if ((await whoIs(req)) === false) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const codes = [...new Set((req.nextUrl.searchParams.get('codes') || '').split(',')
    .map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z0-9._-]{1,40}$/.test(c)))].slice(0, 200)
  if (!codes.length) return NextResponse.json({ items: {} })
  try {
    const got = await fetchItemsBatch(codes)
    const items: Record<string, unknown> = {}
    for (const c of codes) {
      const it = got.get(c)
      items[c] = it ? {
        name: it.canonical_name || it.name || null,
        stock_qty: Number(it.stock_qty ?? it.stock?.stock_qty ?? 0) || 0,
        incoming_qty: Number(it.incoming_qty ?? it.stock?.incoming_qty ?? 0) || 0,
        price: Number(it.price ?? it.price_list_price) || null,
      } : null
    }
    return NextResponse.json({ items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
