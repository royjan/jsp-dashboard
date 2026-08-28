export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getSupplierContext, getCandidateOrdersForShipment } from '@/lib/xpart/queries'
import type { Provenance } from '@/lib/provenance'

/**
 * GET /api/xpart/suppliers/[code]?arrivedOn=YYYY-MM-DD
 *
 * What Xpart holds for one ERP supplier code: open purchase orders, price
 * lists, and — when arrivedOn is given — the orders that could correspond to a
 * shipment that landed that day.
 *
 * A supplier Xpart does not know is not an error; most ERP suppliers aren't in
 * it. It answers linked:false and the panel simply does not render.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  try {
    await initializeSecrets()
    const { code } = await params
    const erpCode = decodeURIComponent(code || '').trim()
    const arrivedOn = new URL(req.url).searchParams.get('arrivedOn')

    const context = await getSupplierContext(erpCode)
    if (!context) {
      return NextResponse.json({
        linked: false,
        provenance: { source: 'unavailable', reason: 'הספק לא מוגדר ב‑Xpart' } satisfies Provenance,
      })
    }

    const candidateOrders = arrivedOn
      ? await getCandidateOrdersForShipment(erpCode, arrivedOn.slice(0, 10))
      : []

    return NextResponse.json({
      linked: true,
      context,
      candidateOrders,
      provenance: {
        source: 'postgres',
        scope: 'Xpart',
        asOf: context.last_order_date ?? undefined,
      } satisfies Provenance,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed'
    console.warn('[xpart/supplier]', message)
    return NextResponse.json({
      linked: false,
      provenance: { source: 'unavailable', reason: message } satisfies Provenance,
    })
  }
}
