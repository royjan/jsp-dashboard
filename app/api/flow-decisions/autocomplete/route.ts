import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getAutocomplete } from '@/lib/chat-admin/flow-decisions'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** GET /api/flow-decisions/autocomplete?lambdaId= */
export async function GET(req: NextRequest) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(req.url)
    const lambdaId = searchParams.get('lambdaId') || 'all'
    return NextResponse.json(await getAutocomplete(lambdaId))
  } catch (error) {
    console.error('[flow-decisions/autocomplete] failed:', error)
    return NextResponse.json({ error: 'Failed to fetch suggestions' }, { status: 500 })
  }
}
