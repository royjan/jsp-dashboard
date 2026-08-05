import { NextResponse } from 'next/server'
import { client } from '@/lib/finansit-client'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })

  try {
    await initializeSecrets()
    const upper = code.toUpperCase()

    // Try direct fetch and history in parallel; if the direct fetch fails (e.g.
    // the code is a historical/superseded alias), fall back to the canonical code.
    const [itemOrNull, history] = await Promise.all([
      client.items.get(upper).catch(() => null),
      client.items.getHistory(upper).catch(() => null),
    ])

    let item = itemOrNull
    if (!item) {
      // Try history chain first
      const canonical = history?.canonical_code
      if (canonical && canonical !== upper) {
        item = await client.items.get(canonical).catch(() => null)
      }
    }
    if (!item) {
      // Try partly.finansit_links mapping (partly code → finansit code)
      const linkResult = await query(
        `SELECT finansit_code FROM partly.finansit_links WHERE partly_item_number = $1 LIMIT 1`,
        [upper]
      ).catch(() => null)
      const linkedCode = (linkResult?.rows[0] as any)?.finansit_code
      if (linkedCode) {
        item = await client.items.get(linkedCode).catch(() => null)
      }
    }
    if (!item && !upper.startsWith('MG')) {
      // MG-brand parts carry an "MG" prefix on the Finansit side only
      // (e.g. partly 10112700 = Finansit MG10112700), so try that as a fallback.
      item = await client.items.get('MG' + upper).catch(() => null)
    }
    // TOYOTA infrastructure: Toyota (SU0*) codes are not stocked in the ERP —
    // their value is the pointer to the equivalent PSA part discovered from
    // shared catalog diagrams (partly.part_links). Resolve to the PSA item.
    let toyotaResolution: { toyotaCode: string; psaCode: string; confidence: string } | null = null
    if (!item && upper.startsWith('SU0')) {
      const links = await query(
        `SELECT gp_other.item_number AS psa_code, pl.confidence
         FROM partly.global_parts gp_self
         JOIN partly.part_links pl ON gp_self.id IN (pl.global_part_id_a, pl.global_part_id_b)
         JOIN partly.global_parts gp_other
           ON gp_other.id = CASE WHEN gp_self.id = pl.global_part_id_a
                                 THEN pl.global_part_id_b ELSE pl.global_part_id_a END
         WHERE gp_self.item_number = $1 AND gp_other.item_number NOT LIKE 'SU0%'
         ORDER BY (pl.confidence = 'high') DESC
         LIMIT 5`,
        [upper]
      ).catch(() => null)
      for (const row of (links?.rows ?? []) as { psa_code: string; confidence: string }[]) {
        const psaItem = await client.items.get(row.psa_code).catch(() => null)
        if (psaItem) {
          item = psaItem
          toyotaResolution = { toyotaCode: upper, psaCode: row.psa_code, confidence: row.confidence }
          break
        }
      }
    }
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    return NextResponse.json({
      ...item,
      canonical_code: history?.canonical_code || item.code,
      canonical_name: history?.canonical_name || item.name,
      item_id_history: history?.item_id_history || item.item_id_history,
      ...(toyotaResolution ? { toyota_resolution: toyotaResolution } : {}),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch item' },
      { status: 500 }
    )
  }
}
