export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getShipmentsFirestore } from '@/lib/firebase'

function extractSupplier(name?: string): string | null {
  if (!name) return null
  return name.trim().split(/\s+/)[0] || null
}

// Detail for one inbound shipment: header + products (scanned/expected/missing/
// faulty/location) + who scanned. Mirrors the SDK's shipments helpers.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initializeSecrets()
    const { id } = await params
    const db = await getShipmentsFirestore()
    const doc = await db.collection('shipments').doc(id).get()
    if (!doc.exists) return NextResponse.json({ error: 'Shipment not found', products: [] }, { status: 404 })
    const data = doc.data() as Record<string, any>

    const prodSnap = await doc.ref.collection('products').get()
    let totalScanned = 0, totalExpected = 0, missing = 0, faulty = 0
    const products = prodSnap.docs.map((p) => {
      const d = p.data() as Record<string, any>
      const scanned = Number(d.scanned) || 0
      const total = Number(d.total) || 0
      totalScanned += scanned; totalExpected += total
      if (scanned < total) missing += total - scanned
      if (d.faulty) faulty += 1
      return {
        part_id: (d.id as string) || p.id,
        description: d.description || '',
        location: d.location || '',
        scanned,
        total,
        missing: Math.max(0, total - scanned),
        faulty: !!d.faulty,
      }
    })
    products.sort((a, b) => b.missing - a.missing)

    // Who scanned (from logs sub-collection), best-effort.
    let scanners: { name: string; count: number }[] = []
    try {
      const logs = await doc.ref.collection('logs').get()
      const byPerson = new Map<string, number>()
      logs.docs.forEach((l) => {
        const n = ((l.data().name as string) || 'Unknown').trim()
        byPerson.set(n, (byPerson.get(n) || 0) + 1)
      })
      scanners = [...byPerson.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
    } catch { /* logs optional */ }

    return NextResponse.json({
      shipment: {
        id: doc.id,
        name: data.name || '',
        supplier: extractSupplier(data.name),
        shipmentDate: data.shipmentDate || '',
        totalScanned, totalExpected, missing, faulty,
        uniqueProducts: products.length,
      },
      products,
      scanners,
    })
  } catch (error) {
    console.error('[shipments/:id] Error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed', products: [] })
  }
}
