import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getRuleStats } from '@/lib/chat-admin/flow-decisions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/flow-decisions/stats — server-aggregated rule-corpus analytics. */
export async function GET() {
  try {
    await initializeSecrets()
    const stats = await getRuleStats()
    return NextResponse.json(stats)
  } catch (error) {
    console.error('[flow-decisions/stats] failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: 500 })
  }
}
