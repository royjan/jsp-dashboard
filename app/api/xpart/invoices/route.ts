export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { listInvoices } from '@/lib/xpart/queries'
import type { Provenance } from '@/lib/provenance'

/** GET /api/xpart/invoices — supplier invoices recorded in Xpart. */
export async function GET() {
  try {
    await initializeSecrets()
    const invoices = await listInvoices()
    return NextResponse.json({
      invoices,
      provenance: { source: 'postgres', rows: invoices.length, scope: 'Xpart' } satisfies Provenance,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed'
    console.warn('[xpart/invoices]', message)
    return NextResponse.json({
      invoices: [],
      provenance: { source: 'unavailable', reason: message } satisfies Provenance,
    })
  }
}
