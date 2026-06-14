import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { reorderQueue } from '@/lib/db/schema'
import { initializeSecrets } from '@/lib/aws-secrets'
import { eq } from 'drizzle-orm'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initializeSecrets()
    const db = await getDb()
    const { id } = await params
    const body = await request.json()

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    }

    if (body.stage !== undefined) {
      updateData.stage = body.stage
      updateData.movedAt = new Date()
    }
    if (body.approvedQty !== undefined) updateData.approvedQty = body.approvedQty
    if (body.notes !== undefined) updateData.notes = body.notes
    if (body.supplierInfo !== undefined) updateData.supplierInfo = body.supplierInfo

    const [updated] = await db
      .update(reorderQueue)
      .set(updateData)
      .where(eq(reorderQueue.id, parseInt(id, 10)))
      .returning()

    if (!updated) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    return NextResponse.json(updated)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update item' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initializeSecrets()
    const db = await getDb()
    const { id } = await params

    const [deleted] = await db
      .delete(reorderQueue)
      .where(eq(reorderQueue.id, parseInt(id, 10)))
      .returning()

    if (!deleted) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete item' },
      { status: 500 }
    )
  }
}
