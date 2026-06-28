import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getDb } from '@/lib/db'
import { deliveries, deliveryPhotos, deliveryStatusLog } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getDeliveryFirestore, toIso } from '@/lib/firebase'

// Outbound deliveries live in the delivery-app Firestore (collection `shipments`),
// keyed by Firestore doc id — NOT the (unused) Postgres `deliveries` uuid table.
const FS_TO_PAGE_STATUS: Record<string, string> = {
  assigned: 'assigned', started: 'in_transit', delivered: 'delivered', failed: 'failed',
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initializeSecrets()
    const { id } = await params
    const db = await getDeliveryFirestore()
    const doc = await db.collection('shipments').doc(id).get()
    if (!doc.exists) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
    }
    const r = doc.data() as Record<string, any>

    let customerName = r.customerName || ''
    if (!customerName && r.customerId) {
      try {
        const c = await db.collection('customers').doc(r.customerId).get()
        customerName = ((c.data()?.name as string) || '').trim()
      } catch { /* optional */ }
    }

    const status = FS_TO_PAGE_STATUS[r.status as string] || r.status || 'assigned'
    const loc = r.deliveredLocation || r.location || null
    const deliveryLat = loc?.latitude ?? loc?.lat ?? r.deliveryLat ?? null
    const deliveryLng = loc?.longitude ?? loc?.lng ?? r.deliveryLng ?? null

    // Synthesize a status timeline from the doc's timestamps.
    const statusLog = [
      r.assignedAt && { status: 'assigned', changedAt: toIso(r.assignedAt), changedBy: r.assignedToName || 'system' },
      r.startedAt && { status: 'in_transit', changedAt: toIso(r.startedAt), changedBy: r.assignedToName || 'system' },
      r.deliveredAt && { status: status === 'failed' ? 'failed' : 'delivered', changedAt: toIso(r.deliveredAt), changedBy: r.assignedToName || 'system' },
    ].filter(Boolean)

    const photos = (r.proofOfDeliveryUrls || []).map((url: string, i: number) => ({
      id: `${id}-${i}`, photoUrl: url, photoType: 'delivery', capturedAt: toIso(r.deliveredAt), notes: null,
    }))

    return NextResponse.json({
      id: doc.id,
      source: 'firestore',
      documentNumber: r.documentNumber || r.orderNumber || doc.id,
      customerCode: r.customerId || '',
      customerName,
      customerAddress: r.address || r.customerAddress || null,
      driverName: r.assignedToName || null,
      status,
      notes: r.notes || null,
      deliveryLat,
      deliveryLng,
      assignedAt: toIso(r.assignedAt),
      departedAt: toIso(r.startedAt),
      deliveredAt: toIso(r.deliveredAt),
      createdAt: toIso(r.createdAt) || toIso(r.assignedAt) || new Date().toISOString(),
      photos,
      statusLog,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch delivery' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initializeSecrets()
    const db = await getDb()
    const { id } = await params
    const body = await request.json()

    const updates: Record<string, any> = { updatedAt: new Date() }

    if (body.status) updates.status = body.status
    if (body.driver_name !== undefined) {
      updates.driverName = body.driver_name
      if (body.driver_name && !updates.status) {
        updates.status = 'assigned'
      }
      updates.assignedAt = new Date()
    }
    if (body.notes !== undefined) updates.notes = body.notes

    // Handle status-specific timestamps
    if (body.status === 'in_transit') updates.departedAt = new Date()
    if (body.status === 'delivered') {
      updates.deliveredAt = new Date()
      if (body.lat) updates.deliveryLat = String(body.lat)
      if (body.lng) updates.deliveryLng = String(body.lng)
    }

    const [updated] = await db
      .update(deliveries)
      .set(updates)
      .where(eq(deliveries.id, id))
      .returning()

    if (!updated) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
    }

    // Log status change if status was updated
    if (body.status) {
      await db.insert(deliveryStatusLog).values({
        deliveryId: id,
        status: body.status,
        changedBy: body.changed_by || 'user',
        notes: body.status_notes || null,
        lat: body.lat ? String(body.lat) : null,
        lng: body.lng ? String(body.lng) : null,
      })
    }

    // Handle photo upload if included
    if (body.photo) {
      await db.insert(deliveryPhotos).values({
        deliveryId: id,
        photoUrl: body.photo,
        photoType: body.photo_type || 'delivery',
        notes: body.photo_notes || null,
      })
    }

    return NextResponse.json(updated)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update delivery' },
      { status: 500 }
    )
  }
}
