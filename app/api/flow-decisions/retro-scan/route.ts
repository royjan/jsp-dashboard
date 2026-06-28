import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { retroScan } from '@/lib/chat-admin/flow-decisions'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** POST /api/flow-decisions/retro-scan — { daysBack?, limit? } */
export async function POST(req: NextRequest) {
  try {
    await initializeSecrets()
    const body = await req.json().catch(() => ({}))
    const daysBack = Math.max(1, Math.min(body.daysBack ?? 30, 365))
    const limit = Math.max(1, Math.min(body.limit ?? 50, 500))
    return NextResponse.json(await retroScan(daysBack, limit))
  } catch (error) {
    console.error('[flow-decisions/retro-scan] failed:', error)
    return NextResponse.json({ error: 'Retro-scan failed' }, { status: 500 })
  }
}
