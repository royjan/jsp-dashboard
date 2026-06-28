/**
 * Learned Pins API (Drizzle).
 * GET    /api/admin/learned-pins        → flow decisions created by the learning loop
 *                                          (learned sources), joined with their pinned direct_part.
 * DELETE /api/admin/learned-pins?id=<fd> → "undo" a learned pin (deletes the direct_part + the
 *                                          flow decision). Scoped to learned sources only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { desc, eq, inArray } from 'drizzle-orm'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getDb } from '@/lib/db'
import { flowDecisionsV2, directParts } from '@/lib/db/schema'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const LEARNED_SOURCES = ['schema_ref_correction', 'agent_correction_seed', 'chat_correction']

export async function GET() {
  try {
    await initializeSecrets()
    const db = await getDb()
    const rows = await db
      .select({ fd: flowDecisionsV2, dp: directParts })
      .from(flowDecisionsV2)
      .leftJoin(directParts, eq(directParts.flowDecisionId, flowDecisionsV2.id))
      .where(inArray(flowDecisionsV2.source, LEARNED_SOURCES))
      .orderBy(desc(flowDecisionsV2.createdAt))
      .limit(500)

    const items = rows.map(({ fd, dp }) => ({
      id: fd.id,
      partDescription: fd.partDescription,
      nav: { category: fd.category, subcategory: fd.subcategory, schema: fd.schema },
      lambdaTarget: fd.lambdaTarget,
      scope:
        fd.vehicleModel || fd.vehicleEngineModel || fd.vehicleYearFrom
          ? { model: fd.vehicleModel, engine: fd.vehicleEngineModel, yearFrom: fd.vehicleYearFrom, yearTo: fd.vehicleYearTo }
          : null,
      source: fd.source,
      status: fd.status,
      confidence: fd.confidence != null ? Number(fd.confidence) : null,
      feedbackCount: fd.feedbackCount,
      createdAt: fd.createdAt,
      createdBy: fd.createdBy,
      pinnedPart: dp
        ? { partId: dp.partId, name: dp.name, price: dp.price != null ? Number(dp.price) : null, currency: dp.currency, inStock: dp.inStock }
        : null,
    }))
    return NextResponse.json({ items, count: items.length })
  } catch (error) {
    console.error('[LearnedPins] list error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await initializeSecrets()
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })
    const db = await getDb()

    const [fd] = await db
      .select({ source: flowDecisionsV2.source })
      .from(flowDecisionsV2)
      .where(eq(flowDecisionsV2.id, id))
      .limit(1)
    if (!fd) return NextResponse.json({ error: 'not found' }, { status: 404 })
    if (!fd.source || !LEARNED_SOURCES.includes(fd.source)) {
      return NextResponse.json({ error: 'refusing to delete a non-learned flow decision here' }, { status: 403 })
    }

    await db.transaction(async (tx) => {
      await tx.delete(directParts).where(eq(directParts.flowDecisionId, id))
      await tx.delete(flowDecisionsV2).where(eq(flowDecisionsV2.id, id))
    })
    return NextResponse.json({ ok: true, deleted: id })
  } catch (error) {
    console.error('[LearnedPins] delete error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
