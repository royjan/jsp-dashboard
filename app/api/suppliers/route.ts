export const maxDuration = 30

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { supplierProfiles, supplierOrderConfirmations } from '@/lib/db/schema'
import { eq, sql, desc } from 'drizzle-orm'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET() {
  try {
    await initializeSecrets()
    const db = await getDb()

    const suppliers = await db
      .select()
      .from(supplierProfiles)
      .orderBy(desc(supplierProfiles.updatedAt))

    // Get pending order counts per supplier
    const confirmations = await db
      .select({
        supplierCode: supplierOrderConfirmations.supplierCode,
        pendingCount: sql<number>`count(*) filter (where ${supplierOrderConfirmations.status} = 'pending')`,
        totalCount: sql<number>`count(*)`,
        lastDelivery: sql<string>`max(${supplierOrderConfirmations.actualDelivery})`,
      })
      .from(supplierOrderConfirmations)
      .groupBy(supplierOrderConfirmations.supplierCode)

    const confirmMap = Object.fromEntries(
      confirmations.map(c => [c.supplierCode, c])
    )

    const enriched = suppliers.map(s => ({
      ...s,
      pendingOrders: confirmMap[s.supplierCode]?.pendingCount || 0,
      totalOrders: confirmMap[s.supplierCode]?.totalCount || 0,
      lastDelivery: confirmMap[s.supplierCode]?.lastDelivery || null,
    }))

    return NextResponse.json({
      suppliers: enriched,
      summary: {
        total: suppliers.length,
        active: suppliers.filter(s => s.active).length,
        pendingOrders: confirmations.reduce((sum, c) => sum + (c.pendingCount || 0), 0),
        overdueDeliveries: 0, // Will compute from estimated vs actual delivery
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    await initializeSecrets()
    const db = await getDb()
    const body = await request.json()

    const { supplierCode, supplierName, contactEmail, contactPhone, leadTimeDays, paymentTerms, notes } = body

    if (!supplierCode || !supplierName) {
      return NextResponse.json({ error: 'supplierCode and supplierName are required' }, { status: 400 })
    }

    // Upsert: insert or update on conflict
    const result = await db
      .insert(supplierProfiles)
      .values({
        supplierCode,
        supplierName,
        contactEmail: contactEmail || null,
        contactPhone: contactPhone || null,
        leadTimeDays: leadTimeDays || null,
        paymentTerms: paymentTerms || null,
        notes: notes || null,
        active: true,
      })
      .onConflictDoUpdate({
        target: supplierProfiles.supplierCode,
        set: {
          supplierName,
          contactEmail: contactEmail || null,
          contactPhone: contactPhone || null,
          leadTimeDays: leadTimeDays || null,
          paymentTerms: paymentTerms || null,
          notes: notes || null,
          updatedAt: new Date(),
        },
      })
      .returning()

    return NextResponse.json({ supplier: result[0] })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
