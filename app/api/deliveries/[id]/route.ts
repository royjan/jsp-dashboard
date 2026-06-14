import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getDb } from '@/lib/db'
import { deliveries, deliveryPhotos, deliveryStatusLog } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initializeSecrets()
    const db = await getDb()
    const { id } = await params

    const [delivery] = await db
      .select()
      .from(deliveries)
      .where(eq(deliveries.id, id))

    if (!delivery) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
    }

    const photos = await db
      .select()
      .from(deliveryPhotos)
      .where(eq(deliveryPhotos.deliveryId, id))
      .orderBy(desc(deliveryPhotos.capturedAt))

    const statusLog = await db
      .select()
      .from(deliveryStatusLog)
      .where(eq(deliveryStatusLog.deliveryId, id))
      .orderBy(desc(deliveryStatusLog.changedAt))

    return NextResponse.json({ ...delivery, photos, statusLog })
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
