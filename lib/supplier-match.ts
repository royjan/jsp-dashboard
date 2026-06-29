import { getDb, query } from '@/lib/db'
import { supplierProfiles } from '@/lib/db/schema'

// Matches an inbound shipment (whose supplier is only implied by the leading
// token of its free-text name, e.g. "08 - 06/2026") to a real Finansit supplier.
//
// Priority:
//   1. Manual `shipment_tag` on a supplier profile (e.g. "MG", "11") — exact,
//      case-insensitive. Always wins so the user can correct/add matches from UI.
//   2. The 2-digit number parsed from the vendor name (auto), best vendor by orders.

export type MatchedSupplier = { code: string; name: string }

// First whitespace token of a shipment name: "08 - 06/2026" → "08", "MG 5" → "MG".
export function leadToken(name?: string | null): string | null {
  if (!name) return null
  return name.trim().split(/\s+/)[0] || null
}

// The 2-digit number a token represents, if any: "8" → "08", "11" → "11".
export function padNum(token?: string | null): string | null {
  if (!token) return null
  const m = token.match(/^(\d{1,3})$/)
  return m ? m[1].padStart(2, '0') : null
}

// The number embedded in a Finansit vendor name ("PCEX AUTOMOTIVE 08" → "08",
// "04 SP - P" → "04"). Lead or trail, padded to 2 digits.
export function supplierNumberFromName(name?: string | null): string | null {
  if (!name) return null
  const lead = name.trim().match(/^(\d{1,3})(?=\s|$)/)
  if (lead) return lead[1].padStart(2, '0')
  const trail = name.trim().match(/(?:^|\s)(\d{1,3})\s*$/)
  if (trail) return trail[1].padStart(2, '0')
  return null
}

export interface SupplierMatcher {
  match: (shipmentName?: string | null) => MatchedSupplier | null
}

export async function buildSupplierMatcher(): Promise<SupplierMatcher> {
  const db = await getDb()

  // Real suppliers derived from purchase docs (61=order, 62=in-transit, 58=invoice).
  const derived = await query(
    `SELECT customer_code AS code, MAX(customer_name) AS name, COUNT(*)::int AS total_orders
       FROM dashboard.documents
      WHERE format IN ('61','62','58') AND customer_code IS NOT NULL AND customer_code <> ''
      GROUP BY customer_code`,
  )

  // Manual tags + names from supplier profiles.
  const profiles = await db.select().from(supplierProfiles)
  const profileName = new Map(profiles.map((p) => [p.supplierCode, p.supplierName]))

  // Auto index: padded number → best vendor by order volume.
  const numMap = new Map<string, MatchedSupplier & { orders: number }>()
  for (const r of derived.rows as Array<{ code: string; name: string; total_orders: number }>) {
    const num = supplierNumberFromName(r.name)
    if (!num) continue
    const existing = numMap.get(num)
    const orders = Number(r.total_orders) || 0
    if (!existing || orders > existing.orders) {
      numMap.set(num, { code: r.code, name: r.name || profileName.get(r.code) || r.code, orders })
    }
  }

  // Manual tag index (highest priority).
  const tagMap = new Map<string, MatchedSupplier>()
  for (const p of profiles) {
    const tag = p.shipmentTag?.trim().toLowerCase()
    if (!tag) continue
    // Prefer the derived (Finansit) name; fall back to the profile name.
    const derivedName = numMap.size
      ? [...numMap.values()].find((v) => v.code === p.supplierCode)?.name
      : undefined
    tagMap.set(tag, { code: p.supplierCode, name: derivedName || p.supplierName })
  }

  return {
    match(shipmentName) {
      const token = leadToken(shipmentName)
      if (!token) return null
      const byTag = tagMap.get(token.toLowerCase())
      if (byTag) return byTag
      const num = padNum(token)
      if (num) {
        const byNum = numMap.get(num)
        if (byNum) return { code: byNum.code, name: byNum.name }
      }
      return null
    },
  }
}
