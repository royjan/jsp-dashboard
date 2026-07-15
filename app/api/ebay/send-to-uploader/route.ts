import { NextResponse } from 'next/server'
import { and, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { ebayItems, ebayRecommendations, type NewEbayRecommendation } from '@/lib/db/schema'
import { getFxToIls } from '@/lib/ebay-browse'

export const dynamic = 'force-dynamic'

// The eBay uploader (jsp-ebay-uploader) lives in the same Neon DB under the
// ebay_uploader schema, so "send to uploader" is a direct insert into its
// recommendations inbox (status=pending, source=dashboard) — no HTTP hop.
// Single-item recommend lives at /api/ebay/recommend; this is the bulk path
// for the /ebay-reco dead-stock table.

type InItem = {
  code: string; name: string; price: number; stock: number
  sold_this_year: number; sold_2025: number; sold_2024: number
  match: number; years_of_stock: number
  ebay_ils: number | null; ebay_url: string | null
}

const MAX_ITEMS = 500
const OPEN_STATUSES = ['pending', 'approved', 'listed']

// GET → codes already in the uploader, so the reco table can badge them up front.
export async function GET() {
  try {
    const db = await getDb()
    const [recs, listed] = await Promise.all([
      db.select({ code: ebayRecommendations.itemCode })
        .from(ebayRecommendations)
        .where(inArray(ebayRecommendations.status, OPEN_STATUSES)),
      db.select({ sku: ebayItems.sku }).from(ebayItems),
    ])
    return NextResponse.json({
      recommended: [...new Set(recs.map(r => r.code))],
      listed: [...new Set(listed.map(r => r.sku))],
    })
  } catch (e) {
    console.error('[send-to-uploader] GET', e)
    return NextResponse.json({ recommended: [], listed: [] })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const raw: InItem[] = Array.isArray(body?.items) ? body.items : []
    const items = raw.filter(i => i && typeof i.code === 'string' && i.code.trim())
    if (!items.length) return NextResponse.json({ error: 'no items' }, { status: 400 })
    if (items.length > MAX_ITEMS) return NextResponse.json({ error: `too many items (max ${MAX_ITEMS})` }, { status: 400 })

    const codes = items.map(i => i.code.trim())
    const db = await getDb()

    // Skip parts already staged/listed in the uploader, and parts with an open
    // recommendation. Rejected ones may be re-sent on purpose.
    const [listed, recs] = await Promise.all([
      db.select({ sku: ebayItems.sku }).from(ebayItems).where(inArray(ebayItems.sku, codes)),
      db.select({ code: ebayRecommendations.itemCode })
        .from(ebayRecommendations)
        .where(and(
          inArray(ebayRecommendations.itemCode, codes),
          inArray(ebayRecommendations.status, OPEN_STATUSES),
        )),
    ])
    const skipListed = new Set(listed.map(r => r.sku))
    const skipRec = new Set(recs.map(r => r.code))
    const fresh = items.filter(i => !skipListed.has(i.code) && !skipRec.has(i.code))

    // ILS→USD for the uploader's suggested price (best effort — null if FX down)
    let ilsPerUsd: number | null = null
    try { ilsPerUsd = (await getFxToIls()).USD || null } catch { /* keep null */ }

    if (fresh.length) {
      const rows: NewEbayRecommendation[] = fresh.map(it => {
        const price = Number(it.price) || 0
        const reasonParts = [
          `הומלץ בדשבורד (מלאי מת) — ציון התאמה ${it.match}`,
          `מלאי ${it.stock} יח׳`,
          it.years_of_stock >= 100 ? '∞ שנות מלאי' : `${it.years_of_stock} שנות מלאי`,
        ]
        if (it.ebay_ils != null) reasonParts.push(`מחיר eBay עד ₪${it.ebay_ils}${it.ebay_url ? ` · ${it.ebay_url}` : ''}`)
        return {
          itemCode: it.code.trim(),
          itemName: it.name || null,
          reason: reasonParts.join(' · '),
          score: Math.max(0, Math.min(100, Math.round(Number(it.match) || 0))),
          suggestedPriceIls: price || null,
          suggestedPriceUsd: price && ilsPerUsd ? Math.round((price / ilsPerUsd) * 100) / 100 : null,
          stockQty: Math.max(0, Math.round(Number(it.stock) || 0)),
          soldThisYear: Number(it.sold_this_year) || 0,
          soldLastYear: Number(it.sold_2025) || 0,
          sold2yAgo: Number(it.sold_2024) || 0,
          status: 'pending',
          source: 'dashboard',
        }
      })
      await db.insert(ebayRecommendations).values(rows)
    }

    return NextResponse.json({
      added: fresh.length,
      added_codes: fresh.map(i => i.code),
      skipped_listed: codes.filter(c => skipListed.has(c)),
      skipped_recommended: codes.filter(c => skipRec.has(c)),
    })
  } catch (e) {
    console.error('[send-to-uploader] POST', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
