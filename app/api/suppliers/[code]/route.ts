export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { supplierProfiles, supplierOrderConfirmations, supplierPriceUploads } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { initializeSecrets } from '@/lib/aws-secrets'
import { fetchDocuments } from '@/lib/finansit-client'
import { getSupplierRegistry } from '@/lib/supplier-registry'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    await initializeSecrets()
    const { code } = await params
    const db = await getDb()

    // Fetch profile
    const profiles = await db
      .select()
      .from(supplierProfiles)
      .where(eq(supplierProfiles.supplierCode, code))
      .limit(1)

    const profile = profiles[0] || null

    // Authoritative name + warehouse alias tags, when the registry knows this
    // supplier. Best-effort — null without Firebase.
    const registry = await getSupplierRegistry()
    const reg = registry.byCode(code)

    // Fetch order confirmations
    const confirmations = await db
      .select()
      .from(supplierOrderConfirmations)
      .where(eq(supplierOrderConfirmations.supplierCode, code))
      .orderBy(desc(supplierOrderConfirmations.createdAt))
      .limit(50)

    // Fetch price uploads
    const uploads = await db
      .select()
      .from(supplierPriceUploads)
      .where(eq(supplierPriceUploads.supplierCode, code))
      .orderBy(desc(supplierPriceUploads.uploadDate))
      .limit(20)

    // Fetch pending supplier orders from Finansit (format 61 = supplier orders)
    let pendingOrders: any[] = []
    try {
      pendingOrders = await fetchDocuments(61, 50)
      // Filter by supplier code if docs have supplier_code/customer_code field matching
      pendingOrders = pendingOrders.filter(
        (doc: any) => doc.customer_code === code || doc.supplier_code === code
      )
    } catch (e) {
      console.warn('[Suppliers] Failed to fetch format 61 documents:', e)
    }

    return NextResponse.json({
      profile,
      registry: reg ? { name: reg.name, aliases: reg.aliases, active: reg.active, currency: reg.currency ?? null } : null,
      confirmations,
      uploads,
      pendingOrders,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    await initializeSecrets()
    const { code } = await params
    const db = await getDb()
    const body = await request.json()

    // Upsert: derived suppliers (e.g. tagged from shipments) may have no profile
    // row yet, so editing one — e.g. setting its shipment tag — must create it.
    const { supplierName, ...rest } = body
    const result = await db
      .insert(supplierProfiles)
      .values({
        supplierCode: code,
        supplierName: supplierName || code,
        ...rest,
      })
      .onConflictDoUpdate({
        target: supplierProfiles.supplierCode,
        set: {
          ...(supplierName !== undefined ? { supplierName } : {}),
          ...rest,
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
