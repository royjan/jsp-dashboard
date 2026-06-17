import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getDb } from '@/lib/db'
import { deliveries, deliveryStatusLog } from '@/lib/db/schema'
import { eq, desc, and } from 'drizzle-orm'
import { fetchDocumentDetail } from '@/lib/finansit-client'
import { getDeliveryFirestore, toIso } from '@/lib/firebase'

export const maxDuration = 30

// Outbound deliveries (Jan → customers) live in the `delivery-app` Firestore
// (collection `shipments`). Page status enum is pending/assigned/in_transit/
// delivered/failed; Firestore uses assigned/started/delivered/failed.
const FS_TO_PAGE_STATUS: Record<string, string> = {
  assigned: 'assigned', started: 'in_transit', delivered: 'delivered', failed: 'failed',
}

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') || undefined
    const dateFrom = searchParams.get('from') || undefined
    const dateTo = searchParams.get('to') || undefined
    const limit = Math.min(Number(searchParams.get('limit')) || 200, 500)

    const fsStatus = status === 'in_transit' ? 'started' : status
    const db = await getDeliveryFirestore()
    let q: FirebaseFirestore.Query = db.collection('shipments')
    if (fsStatus) q = q.where('status', '==', fsStatus)
    const timeField = fsStatus === 'delivered' ? 'deliveredAt' : fsStatus === 'started' ? 'startedAt' : 'assignedAt'
    if (dateFrom) q = q.where(timeField, '>=', new Date(dateFrom))
    if (dateTo) q = q.where(timeField, '<=', new Date(dateTo + 'T23:59:59Z'))
    q = q.orderBy(timeField, 'desc').limit(limit)

    const snap = await q.get()

    // customerId → name (delivery docs may omit customerName)
    const custNames = new Map<string, string>()
    try {
      const cs = await db.collection('customers').get()
      cs.docs.forEach((d) => { const n = ((d.data()?.name as string) || '').trim(); if (n) custNames.set(d.id, n) })
    } catch { /* customers collection optional */ }

    const out = snap.docs.map((d) => {
      const r = d.data() as Record<string, any>
      return {
        id: d.id,
        documentNumber: r.documentNumber || r.orderNumber || d.id,
        customerCode: r.customerId || '',
        customerName: r.customerName || custNames.get(r.customerId) || '',
        customerAddress: r.address || r.customerAddress || null,
        driverName: r.assignedToName || null,
        status: FS_TO_PAGE_STATUS[r.status as string] || r.status || 'assigned',
        assignedAt: toIso(r.assignedAt),
        departedAt: toIso(r.startedAt),
        deliveredAt: toIso(r.deliveredAt),
        createdAt: toIso(r.createdAt) || toIso(r.assignedAt),
        notes: r.notes || null,
        proofOfDeliveryUrls: r.proofOfDeliveryUrls || [],
        shippingMethodCode: r.shippingMethodCode || null,
      }
    })

    return NextResponse.json({ deliveries: out })
  } catch (error) {
    // Degrade to an empty board (not a 500) — e.g. before the Firebase env vars
    // are set — so the page renders cleanly instead of erroring.
    console.error('[deliveries] Error:', error)
    return NextResponse.json({ deliveries: [], note: error instanceof Error ? error.message : 'unavailable' })
  }
}

export async function POST(request: Request) {
  try {
    await initializeSecrets()
    const db = await getDb()
    const body = await request.json()
    const { document_number, driver_name } = body

    if (!document_number) {
      return NextResponse.json({ error: 'document_number is required' }, { status: 400 })
    }

    // Fetch document details from Finansit (format 21 = delivery note)
    let docDetail: any = null
    try {
      docDetail = await fetchDocumentDetail(21, document_number)
    } catch {
      // Document may not exist in Finansit, allow manual creation
    }

    const customerCode = docDetail?.customer_code || body.customer_code || ''
    const customerName = docDetail?.customer_name || body.customer_name || ''
    const customerAddress = docDetail?.address || body.customer_address || ''

    const [newDelivery] = await db
      .insert(deliveries)
      .values({
        documentNumber: String(document_number),
        customerCode,
        customerName,
        customerAddress,
        driverName: driver_name || null,
        status: driver_name ? 'assigned' : 'pending',
        assignedAt: driver_name ? new Date() : null,
      })
      .returning()

    // Log initial status
    await db.insert(deliveryStatusLog).values({
      deliveryId: newDelivery.id,
      status: newDelivery.status,
      changedBy: 'system',
      notes: `Created from document ${document_number}`,
    })

    return NextResponse.json(newDelivery, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create delivery' },
      { status: 500 }
    )
  }
}
