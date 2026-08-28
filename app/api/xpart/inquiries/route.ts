export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { listInquiries } from '@/lib/xpart/queries'
import type { Provenance } from '@/lib/provenance'

/** GET /api/xpart/inquiries — the procurement rounds Xpart is running. */
export async function GET() {
  try {
    await initializeSecrets()
    const inquiries = await listInquiries()
    return NextResponse.json({
      inquiries,
      provenance: { source: 'postgres', rows: inquiries.length, scope: 'Xpart' } satisfies Provenance,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed'
    console.warn('[xpart/inquiries]', message)
    return NextResponse.json({
      inquiries: [],
      provenance: { source: 'unavailable', reason: message } satisfies Provenance,
    })
  }
}
