import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { alertRules } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

type RouteParams = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const body = await request.json()
    const db = await getDb()
    const data: Record<string, unknown> = { updatedAt: new Date() }
    if (typeof body.name === 'string') data.name = body.name.trim()
    if (typeof body.enabled === 'boolean') data.enabled = body.enabled
    if (typeof body.thresholdQty === 'number')
      data.thresholdQty = String(body.thresholdQty)
    if (typeof body.cooldownHours === 'number')
      data.cooldownHours = body.cooldownHours
    if (Array.isArray(body.recipients)) data.recipients = body.recipients
    if (Array.isArray(body.itemCodes))
      data.itemCodes = body.itemCodes.map((c: string) => c.toUpperCase())
    const [updated] = await db
      .update(alertRules)
      .set(data)
      .where(eq(alertRules.id, id))
      .returning()
    return NextResponse.json({ rule: updated })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const db = await getDb()
    await db.delete(alertRules).where(eq(alertRules.id, id))
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}
