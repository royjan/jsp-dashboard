export const maxDuration = 30

import { NextResponse } from 'next/server'
import { getDb, query } from '@/lib/db'
import { supplierProfiles } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'
import { initializeSecrets } from '@/lib/aws-secrets'
import { padNum, supplierNumberFromName } from '@/lib/supplier-match'
import { getSupplierRegistry, type SupplierRegistry } from '@/lib/supplier-registry'

// The warehouse tags suppliers by a short number (e.g. "08"). The registry
// states those tags outright as `aliases`; for vendors it doesn't know, fall
// back to the number Finansit embeds in the name ("PCEX AUTOMOTIVE 08").
function shipmentNumber(registry: SupplierRegistry, code: string, name: string): string | null {
  const aliases = registry.byCode(code)?.aliases ?? []
  for (const a of aliases) {
    const n = padNum(a)
    if (n) return n
  }
  return supplierNumberFromName(name)
}

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const db = await getDb()

    // The Firestore registry is the authority on supplier NAMES: the derived
    // name below is a MAX() over purchase documents, which regularly picks a
    // junk string (0000055082 came out as "70 נשלח אושר"). Best-effort —
    // without Firebase it degrades to empty and the derived names stand.
    const registry = await getSupplierRegistry()

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
      const reg = registry.byCode(r.code)
      // registry > manual profile > derived: profile rows were themselves
      // seeded from the derived name, so they carry the same junk.
      const name = reg?.name || p?.supplierName || r.name || r.code
      return {
        supplierCode: r.code,
        supplierName: name,
        supplierNumber: shipmentNumber(registry, r.code, name),
        aliases: reg?.aliases ?? [],
        inRegistry: !!reg,
        shipmentTag: p?.shipmentTag ?? null,
        active: reg?.active ?? p?.active ?? true,
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
        const reg = registry.byCode(p.supplierCode)
        const name = reg?.name || p.supplierName
        suppliers.push({
          supplierCode: p.supplierCode,
          supplierName: name,
          supplierNumber: shipmentNumber(registry, p.supplierCode, name || ''),
          aliases: reg?.aliases ?? [],
          inRegistry: !!reg,
          shipmentTag: p.shipmentTag ?? null,
          active: reg?.active ?? p.active ?? true,
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

    // Registry suppliers the ERP hasn't traded with yet (no purchase docs, no
    // profile) — they still exist and can receive shipments.
    for (const reg of registry.all()) {
      if (suppliers.some((s) => s.supplierCode === reg.code)) continue
      suppliers.push({
        supplierCode: reg.code,
        supplierName: reg.name,
        supplierNumber: shipmentNumber(registry, reg.code, reg.name),
        aliases: reg.aliases,
        inRegistry: true,
        shipmentTag: null,
        active: reg.active,
        leadTimeDays: null,
        contactEmail: null,
        contactPhone: null,
        paymentTerms: null,
        pendingOrders: 0,
        totalOrders: 0,
        lastDelivery: null,
      })
    }

    // If a search query is provided, sort by relevance. Users type the supplier
    // number with an optional "#" prefix (e.g. "#11" → vendor number 11), so strip
    // it. Rank: exact number match, then number/code match, then name/code contains.
    const rawQ = new URL(request.url).searchParams.get('q') || ''
    const q = rawQ.trim().replace(/^#/, '').trim()
    const qLower = q.toLowerCase()
    const sorted = q
      ? [...suppliers].sort((a, b) => {
          const rank = (s: typeof suppliers[0]) => {
            const num = s.supplierNumber || ''
            const code = (s.supplierCode || '').toLowerCase()
            const name = (s.supplierName || '').toLowerCase()
            const aliases = (s.aliases || []).map((a) => a.toLowerCase())
            if (num === q || aliases.includes(qLower)) return 0
            if (num.includes(q) || code === qLower) return 1
            if (name.includes(qLower) || code.includes(qLower)) return 2
            return 3
          }
          const rd = rank(a) - rank(b)
          if (rd !== 0) return rd
          return (b.totalOrders ?? 0) - (a.totalOrders ?? 0)
        })
      : suppliers

    return NextResponse.json({
      suppliers: sorted,
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
