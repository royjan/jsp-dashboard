export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getShipmentsFirestore } from '@/lib/firebase'

// Inbound shipments (suppliers → Jan) live in the `shipments-app` Firestore.
// Supplier number = first whitespace token of shipment.name (e.g. "07 Reinz …").
function extractSupplier(name?: string): string | null {
  if (!name) return null
  return name.trim().split(/\s+/)[0] || null
}

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const supplier = searchParams.get('supplier') || undefined
    const date = searchParams.get('date') || undefined
    const limit = Math.min(Number(searchParams.get('limit')) || 30, 100)
    const offset = Math.max(0, Number(searchParams.get('offset')) || 0)

    const db = await getShipmentsFirestore()
    // Fetch one extra to detect whether there's a next page.
    let q: FirebaseFirestore.Query = db.collection('shipments').orderBy('shipmentDate', 'desc')
    if (date) {
      q = db
        .collection('shipments')
        .where('shipmentDate', '>=', `${date}T00:00:00.000`)
        .where('shipmentDate', '<', `${date}T23:59:59.999`)
    }
    q = q.offset(offset).limit(limit + 1)

    const snap = await q.get()
    const hasMore = snap.docs.length > limit
    const pageDocs = snap.docs.slice(0, limit)
    const shipments: any[] = []
    for (const doc of pageDocs) {
      const data = doc.data() as Record<string, any>
      const sup = extractSupplier(data.name)
      if (supplier && sup?.toLowerCase() !== supplier.toLowerCase()) continue
      // Aggregate the products sub-collection (scanned / expected / missing).
      const prodSnap = await doc.ref.collection('products').get()
      let totalScanned = 0, totalExpected = 0, missing = 0, faulty = 0
      prodSnap.docs.forEach((p) => {
        const pd = p.data() as Record<string, any>
        const sc = Number(pd.scanned) || 0, tot = Number(pd.total) || 0
        totalScanned += sc; totalExpected += tot
        if (sc < tot) missing += tot - sc
        if (pd.faulty) faulty += 1
      })
      shipments.push({
        id: doc.id,
        name: data.name || '',
        supplier: sup,
        shipmentDate: data.shipmentDate || '',
        totalScanned, totalExpected, missing, faulty,
        uniqueProducts: prodSnap.size,
      })
    }

    // Distinct-supplier roll-up
    const supMap = new Map<string, { count: number; latest: string }>()
    for (const s of shipments) {
      if (!s.supplier) continue
      const c = supMap.get(s.supplier) || { count: 0, latest: '' }
      c.count += 1
      if (s.shipmentDate > c.latest) c.latest = s.shipmentDate
      supMap.set(s.supplier, c)
    }
    const suppliers = [...supMap.entries()]
      .map(([s, v]) => ({ supplier: s, ...v }))
      .sort((a, b) => b.latest.localeCompare(a.latest))

    return NextResponse.json({
      shipments,
      suppliers,
      hasMore,
      offset,
      limit,
      summary: {
        total: shipments.length,
        suppliers: suppliers.length,
        totalScanned: shipments.reduce((s, x) => s + x.totalScanned, 0),
        missing: shipments.reduce((s, x) => s + x.missing, 0),
      },
    })
  } catch (error) {
    // Degrade to empty (not a 500) — e.g. before the Firebase env vars are set.
    console.error('[shipments] Error:', error)
    return NextResponse.json({ shipments: [], suppliers: [], summary: null, note: error instanceof Error ? error.message : 'unavailable' })
  }
}
