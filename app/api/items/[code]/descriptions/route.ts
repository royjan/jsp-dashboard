export const maxDuration = 45

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getItemDescriptions, getSupplierDescriptions } from '@/lib/xpart/queries'
import { fetchItemHistory } from '@/lib/finansit-client'
import { readQueryAsync } from '@/lib/neon-read'
import type { Provenance } from '@/lib/provenance'

/**
 * GET /api/items/[code]/descriptions
 *
 * Every name this part goes by, and who calls it that.
 *
 * The item card shows one name — whatever the ERP has, or, when the ERP's is
 * blank, whichever of partly / Lubinski / English happened to win a silent
 * COALESCE. That precedence hides real disagreement: 1623199180 is "ראש צילינדר
 * חדש קומפלט" in the manufacturer catalogue and "ראש מנוע" on Lubinski's price
 * list, and nothing on the page said so.
 *
 * Four sources are gathered, all keyed by ERP code:
 *   Xpart item_descriptions   4 import channels, HE and EN
 *   partly.global_parts       the manufacturer catalogue, HE and EN
 *   competitor_items          what each competitor's price sheet calls it
 *   xpart.lubinski_price_list the official distributor's own wording
 *   order_items → orders      what each SUPPLIER called it when we ordered it
 *
 * The last one is the only per-supplier naming that exists: item_descriptions
 * has no supplier column and collapses every price list into one 'price_list'
 * row, so before this the card could say "supplier price list" but never which
 * supplier. Purchase order lines carry both.
 */
interface Alias {
  source: string
  sourceKind: 'xpart' | 'catalog' | 'competitor' | 'distributor' | 'supplier'
  language: string | null
  description: string
  isPrimary?: boolean
  /** Supplier rows only: when a supplier last ordered the part under this name. */
  lastSeen?: string | null
}

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    await initializeSecrets()
    const { code } = await params
    const itemCode = decodeURIComponent(code || '').trim()
    if (!itemCode) return NextResponse.json({ error: 'code required' }, { status: 400 })

    // A part re-coded by the ERP carries its descriptions on whichever code the
    // importer saw, so ask for the chain too.
    let codes = [itemCode]
    try {
      const history = await fetchItemHistory(itemCode)
      codes = [
        ...new Set(
          [itemCode, history?.canonical_code, ...(history?.item_id_history ?? [])]
            .map((c: unknown) => String(c ?? '').trim())
            .filter(Boolean),
        ),
      ]
    } catch {
      // FINAPI is LAN-only.
    }

    const aliases: Alias[] = []

    const settle = await Promise.allSettled([
      getItemDescriptions(codes),
      readQueryAsync(
        `SELECT description, hebrew_description
           FROM partly.global_parts WHERE item_number = ANY($1::text[])`,
        [codes],
      ),
      readQueryAsync(
        `SELECT DISTINCT ON (c.name) c.name AS competitor, ci.name AS description
           FROM dashboard.competitor_items ci
           JOIN dashboard.competitors c ON c.id = ci.competitor_id
          WHERE ci.item_code = ANY($1::text[]) AND ci.name IS NOT NULL AND ci.name <> ''
          ORDER BY c.name, ci.created_at DESC`,
        [codes],
      ),
      readQueryAsync(
        `SELECT description FROM xpart.lubinski_price_list
          WHERE item_id = ANY($1::text[]) AND COALESCE(NULLIF(btrim(description), ''), NULL) IS NOT NULL
          LIMIT 1`,
        [codes],
      ),
      getSupplierDescriptions(codes),
    ])

    if (settle[0].status === 'fulfilled') {
      for (const d of settle[0].value) {
        aliases.push({
          source: d.source,
          sourceKind: 'xpart',
          language: d.language,
          description: d.description,
          isPrimary: d.is_primary,
        })
      }
    }
    if (settle[1].status === 'fulfilled') {
      for (const r of settle[1].value.rows as Array<{ description: string | null; hebrew_description: string | null }>) {
        // partly writes '-' where it has no Hebrew name; that is a placeholder,
        // not a description.
        const he = r.hebrew_description && r.hebrew_description !== '-' ? r.hebrew_description : null
        if (he) aliases.push({ source: 'catalog', sourceKind: 'catalog', language: 'he', description: he })
        if (r.description) {
          aliases.push({ source: 'catalog', sourceKind: 'catalog', language: 'en', description: r.description })
        }
      }
    }
    if (settle[2].status === 'fulfilled') {
      for (const r of settle[2].value.rows as Array<{ competitor: string; description: string }>) {
        aliases.push({ source: r.competitor, sourceKind: 'competitor', language: null, description: r.description })
      }
    }
    if (settle[3].status === 'fulfilled') {
      for (const r of settle[3].value.rows as Array<{ description: string | null }>) {
        if (r.description?.trim()) {
          aliases.push({
            source: 'Lubinski',
            sourceKind: 'distributor',
            language: 'he',
            description: r.description.trim(),
          })
        }
      }
    }

    if (settle[4].status === 'fulfilled') {
      for (const r of settle[4].value) {
        aliases.push({
          source: r.suppliers,
          sourceKind: 'supplier',
          language: null,
          description: r.description,
          lastSeen: r.last_seen,
        })
      }
    }

    // Two channels importing the identical string is not two names.
    const seen = new Set<string>()
    const deduped = aliases.filter(a => {
      const key = `${a.source}|${a.description.trim().toLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const distinctNames = new Set(deduped.map(a => a.description.trim().toLowerCase())).size

    return NextResponse.json({
      itemCode,
      chainCodes: codes,
      aliases: deduped,
      distinctNames,
      provenance: {
        source: deduped.length ? 'postgres' : 'unavailable',
        rows: deduped.length,
        scope: 'Xpart · קטלוג · מתחרים · ספקים',
        reason: deduped.length ? undefined : 'לא נמצאו תיאורים נוספים',
      } satisfies Provenance,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}
