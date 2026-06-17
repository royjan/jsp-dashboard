export const maxDuration = 30

import { NextResponse } from 'next/server'
import { getDb, query } from '@/lib/db'
import { supplierProfiles } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'
import { initializeSecrets } from '@/lib/aws-secrets'

// The shipments-app tags suppliers by a short number (e.g. "08"); Finansit
// embeds that number in the vendor name ("PCEX AUTOMOTIVE 08", "04 SP - P",
// "70 נשלח אושר"). Pull it out so a supplier is findable by its number and can
// be linked from inbound shipments.
function supplierNumberFromName(name: string): string | null {
  if (!name) return null
  const lead = name.trim().match(/^(\d{1,3})(?=\s|$)/)
  if (lead) return lead[1].padStart(2, '0')
  const trail = name.trim().match(/(?:^|\s)(\d{1,3})\s*$/)
  if (trail) return trail[1].padStart(2, '0')
  return null
}

export async function GET() {
  try {
    await initializeSecrets()
    const db = await getDb()

    // Manual profiles (lead time, contacts, payment terms) — enrichment only.
    const profiles = await db.select().from(supplierProfiles).orderBy(desc(supplierProfiles.updatedAt))
    const profileMap = Object.fromEntries(profiles.map((p) => [p.supplierCode, p]))

    // Derive the actual supplier list from purchase documents — on a purchase
    // doc the "customer" IS the supplier. 61=order, 62=in-transit, 58=invoice.
    // status '0'/'' = open → pending.
    const derived = await query(
      `SELECT customer_code AS code, MAX(customer_name) AS name,
              COUNT(*)::int AS total_orders,
              COUNT(*) FILTER (WHERE format='61' AND COALESCE(status,'') IN ('','0'))::int AS pending_orders,
              MAX(doc_date)::text AS last_order
       FROM dashboard.documents
       WHERE format IN ('61','62','58') AND customer_code IS NOT NULL AND customer_code <> ''
       GROUP BY customer_code
       ORDER BY total_orders DESC
       LIMIT 500`,
    )

    const suppliers = derived.rows.map((r: any) => {
      const p = profileMap[r.code]
      return {
        supplierCode: r.code,
        supplierName: r.name || p?.supplierName || r.code,
        supplierNumber: supplierNumberFromName(r.name || ''),
        active: p?.active ?? true,
        leadTimeDays: p?.leadTimeDays ?? null,
        contactEmail: p?.contactEmail ?? null,
        contactPhone: p?.contactPhone ?? null,
        paymentTerms: p?.paymentTerms ?? null,
        pendingOrders: Number(r.pending_orders) || 0,
        totalOrders: Number(r.total_orders) || 0,
        lastDelivery: r.last_order || null,
      }
    })

    // Manual-only suppliers that have no purchase docs yet.
    for (const p of profiles) {
      if (!suppliers.some((s) => s.supplierCode === p.supplierCode)) {
        suppliers.push({
          supplierCode: p.supplierCode,
          supplierName: p.supplierName,
          supplierNumber: supplierNumberFromName(p.supplierName || ''),
          active: p.active ?? true,
          leadTimeDays: p.leadTimeDays ?? null,
          contactEmail: p.contactEmail ?? null,
          contactPhone: p.contactPhone ?? null,
          paymentTerms: p.paymentTerms ?? null,
          pendingOrders: 0,
          totalOrders: 0,
          lastDelivery: null,
        })
      }
    }

    return NextResponse.json({
      suppliers,
      summary: {
        total: suppliers.length,
        active: suppliers.filter((s) => s.active).length,
        pendingOrders: suppliers.reduce((sum, s) => sum + s.pendingOrders, 0),
        overdueDeliveries: 0,
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
