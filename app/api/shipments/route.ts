export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { dateSortKey, getShipmentsFirestore, toIso } from '@/lib/firebase'
import { buildSupplierMatcher } from '@/lib/supplier-match'
import { getSupplierRegistry, resolveShipmentSupplier } from '@/lib/supplier-registry'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const supplier = searchParams.get('supplier') || undefined
    // '1' = only internal deliveries, '0' = only real suppliers.
    const internal = searchParams.get('internal') || undefined
    const date = searchParams.get('date') || undefined
    const limit = Math.min(Number(searchParams.get('limit')) || 30, 100)
    const offset = Math.max(0, Number(searchParams.get('offset')) || 0)

    const db = await getShipmentsFirestore()
    // The Firestore supplier registry is authoritative; the name-parsing
    // matcher stays as the last-resort fallback. Both are best-effort.
    const [registry, matcher] = await Promise.all([
      getSupplierRegistry(),
      buildSupplierMatcher().catch(() => null),
    ])
    // `shipmentDate` is written as an ISO string on older docs and as a real
    // Timestamp on newer ones, and Firestore orders by TYPE before value —
    // Timestamp ranks below String, so orderBy('shipmentDate','desc') pushes
    // every Timestamp doc behind every string doc no matter when it happened
    // (that hid the most recent shipments on the last page). The same split
    // breaks a `where` range filter, which only ever matches one of the two
    // types. So read the collection — a few hundred small header docs — and do
    // the ordering, date filter and paging here on normalised ISO values.
    const snap = await db.collection('shipments').get()

    const supplierFilter = supplier?.trim().toLowerCase()
    // Everything matching the date filter, before the supplier/internal one —
    // the roll-up below is built from this so the UI's filter options stay put
    // once one of them is selected.
    const base = snap.docs
      .map((doc) => {
        const data = doc.data() as Record<string, unknown>
        const { folder, isInternal, tag, matchedSupplier } = resolveShipmentSupplier(data, registry, matcher)
        return {
          doc,
          name: (data.name as string) || '',
          folder,
          isInternal,
          tag,
          matchedSupplier,
          shipmentDate: toIso(data.shipmentDate) || '',
          createdAt: toIso(data.createdAt),
          sortKey: dateSortKey(data.shipmentDate, data.createdAt),
        }
      })
      .filter((h) => !date || h.sortKey.slice(0, 10) === date)
      .sort((a, b) => b.sortKey.localeCompare(a.sortKey))

    const headers = base
      .filter((h) => (internal === '1' ? h.isInternal : internal === '0' ? !h.isInternal : true))
      .filter(
        (h) =>
          // A filter value can be a supplier code, a folder or an alias tag.
          // INTERNAL rows match none of them: they all share the one folder
          // "לובינסקי", so a folder match here handed every other sender's
          // receipt to whoever the folder is named after. They are reachable
          // through `internal=1` only.
          !supplierFilter ||
          (!h.isInternal &&
            (h.matchedSupplier?.code.toLowerCase() === supplierFilter ||
              h.folder?.toLowerCase() === supplierFilter ||
              h.tag?.toLowerCase() === supplierFilter)),
      )

    const total = headers.length
    const pageHeaders = headers.slice(offset, offset + limit)
    const hasMore = offset + limit < total

    // Aggregate each page row's products sub-collection (scanned / expected /
    // missing). Only the page is read — the roll-up below needs headers only.
    const shipments = await Promise.all(
      pageHeaders.map(async (h) => {
        const prodSnap = await h.doc.ref.collection('products').get()
        let totalScanned = 0, totalExpected = 0, missing = 0, faulty = 0
        prodSnap.docs.forEach((p) => {
          const pd = p.data() as Record<string, unknown>
          const sc = Number(pd.scanned) || 0, tot = Number(pd.total) || 0
          totalScanned += sc; totalExpected += tot
          if (sc < tot) missing += tot - sc
          if (pd.faulty) faulty += 1
        })
        return {
          id: h.doc.id,
          name: h.name,
          supplier: h.tag,
          folder: h.folder,
          isInternal: h.isInternal,
          matchedSupplier: h.matchedSupplier,
          shipmentDate: h.shipmentDate,
          createdAt: h.createdAt,
          totalScanned, totalExpected, missing, faulty,
          uniqueProducts: prodSnap.size,
        }
      }),
    )

    // Distinct-supplier roll-up — keyed by the real supplier code, built from
    // `base` (pre supplier/internal filter) so it doubles as the filter's
    // option list and doesn't collapse to one entry once a filter is applied.
    // Internal deliveries are not a supplier: they get one count rather than
    // inflating this one. They used to roll up per sender, which meant deriving
    // a sender — see resolveShipmentSupplier. One "פנימי" chip, one number.
    const supMap = new Map<string, { name: string; count: number; latest: string }>()
    let internalCount = 0
    for (const h of base) {
      if (h.isInternal) {
        internalCount += 1
        continue
      }
      if (!h.matchedSupplier) continue
      const { code, name } = h.matchedSupplier
      const c = supMap.get(code) || { name, count: 0, latest: '' }
      c.count += 1
      if (h.sortKey > c.latest) c.latest = h.sortKey
      supMap.set(code, c)
    }
    const suppliers = [...supMap.entries()]
      .map(([code, v]) => ({ supplier: code, ...v }))
      .sort((a, b) => b.latest.localeCompare(a.latest))

    return NextResponse.json({
      shipments,
      suppliers,
      internalCount,
      unfilteredTotal: base.length,
      hasMore,
      offset,
      limit,
      total,
      summary: {
        // total/scanned/missing are this page; suppliers is the whole set.
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
