import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getCoverage } from '@/lib/chat-admin/flow-decisions'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** GET /api/flow-decisions/coverage */
export async function GET() {
  try {
    await initializeSecrets()
    return NextResponse.json(await getCoverage())
  } catch (error) {
    console.error('[flow-decisions/coverage] failed:', error)
    return NextResponse.json({ error: 'Failed to compute coverage' }, { status: 500 })
  }
}
