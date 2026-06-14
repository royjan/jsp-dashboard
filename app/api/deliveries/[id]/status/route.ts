import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getDb } from '@/lib/db'
import { deliveries, deliveryStatusLog } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initializeSecrets()
    const db = await getDb()
    const { id } = await params
    const body = await request.json()
    const { status, changed_by, notes, lat, lng } = body

    if (!status) {
      return NextResponse.json({ error: 'status is required' }, { status: 400 })
    }

    // Update delivery status
    const updates: Record<string, any> = {
      status,
      updatedAt: new Date(),
    }

    if (status === 'assigned') updates.assignedAt = new Date()
    if (status === 'in_transit') updates.departedAt = new Date()
    if (status === 'delivered') {
      updates.deliveredAt = new Date()
      if (lat) updates.deliveryLat = String(lat)
      if (lng) updates.deliveryLng = String(lng)
    }

    const [updated] = await db
      .update(deliveries)
      .set(updates)
      .where(eq(deliveries.id, id))
      .returning()

    if (!updated) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
    }

    // Log the status change
    await db.insert(deliveryStatusLog).values({
      deliveryId: id,
      status,
      changedBy: changed_by || 'driver',
      notes: notes || null,
      lat: lat ? String(lat) : null,
      lng: lng ? String(lng) : null,
    })

    return NextResponse.json(updated)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update status' },
      { status: 500 }
    )
  }
}
