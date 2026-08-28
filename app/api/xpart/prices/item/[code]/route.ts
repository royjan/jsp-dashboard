export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getItemSupplierPrices } from '@/lib/xpart/prices'
import { fetchItemHistory } from '@/lib/finansit-client'
import type { Provenance } from '@/lib/provenance'

/**
 * GET /api/xpart/prices/item/[code]
 *
 * What every supplier charges for one part, from the mirrored Xpart price lists.
 * Retail (the official distributor) comes back flagged separately — it is the
 * price we sell against, not a supplier we can buy from.
 *
 * The supersession chain is consulted too, because a supplier quotes whichever
 * number their list was built on and the part we stock under the new code is
 * often priced under the old one — but only to FILL suppliers the exact code
 * has no row for. The exact code always wins where it has an answer: merging
 * "cheapest across the chain" quietly rewrote retail to a sibling code's price,
 * which is a different part number's shelf price and understates margin.
 *
 * Chain codes come from one FINAPI history call, not itemChainCodes() — that
 * builds the whole 112k-item catalog map and took two minutes cold, to decorate
 * a panel on one item card.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    await initializeSecrets()
    const { code } = await params
    const itemCode = decodeURIComponent(code || '').trim()
    if (!itemCode) return NextResponse.json({ error: 'code required' }, { status: 400 })

    const exact = await getItemSupplierPrices(itemCode)
    const bySupplier = new Map(exact.map(r => [r.supplier_code, { ...r, via_code: itemCode }]))

    let chainCodes: string[] = []
    try {
      const history = await fetchItemHistory(itemCode)
      chainCodes = [
        ...new Set(
          [history?.canonical_code, ...(history?.item_id_history ?? [])]
            .map((c: unknown) => String(c ?? '').trim())
            .filter(c => c && c !== itemCode),
        ),
      ]
    } catch {
      // FINAPI is LAN-only. Off-network the exact code still answers.
    }

    for (const sibling of chainCodes) {
      for (const row of await getItemSupplierPrices(sibling)) {
        // Fill only. A supplier that priced the exact code keeps that price.
        if (!bySupplier.has(row.supplier_code)) {
          bySupplier.set(row.supplier_code, { ...row, via_code: sibling })
        }
      }
    }

    const prices = [...bySupplier.values()].sort(
      (a, b) => Number(a.is_retail) - Number(b.is_retail) || (a.landed_ils ?? 0) - (b.landed_ils ?? 0),
    )
    const codes = [itemCode, ...chainCodes]

    const retail = prices.find(p => p.is_retail) ?? null
    const purchasable = prices.filter(p => !p.is_retail)
    const cheapest = purchasable[0] ?? null

    const provenance: Provenance = {
      source: prices.length ? 'postgres' : 'unavailable',
      rows: prices.length,
      scope: 'מחירוני ספקים מ‑Xpart',
      asOf: prices.map(p => p.effective_date).filter(Boolean).sort().at(-1) ?? undefined,
      reason: prices.length ? undefined : 'אין מחיר ספק לפריט זה',
    }

    return NextResponse.json({
      itemCode,
      chainCodes: codes,
      prices,
      retailIls: retail?.price ?? null,
      cheapestLandedIls: cheapest?.landed_ils ?? null,
      cheapestSupplier: cheapest?.supplier_name ?? null,
      spreadIls:
        purchasable.length > 1
          ? (purchasable.at(-1)?.landed_ils ?? 0) - (purchasable[0]?.landed_ils ?? 0)
          : null,
      provenance,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}
