import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { setDefaultFlowDecision, getFlowDecisionById } from '@/lib/chat-admin/flow-decisions'

export const dynamic = 'force-dynamic'

/** POST or PUT /api/flow-decisions/[id]/set-default */
async function handle(id: string) {
  const ok = await setDefaultFlowDecision(id)
  if (!ok) return NextResponse.json({ error: 'Flow decision not found' }, { status: 404 })
  return NextResponse.json(await getFlowDecisionById(id))
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initializeSecrets()
    const { id } = await params
    return await handle(id)
  } catch (error) {
    console.error('[flow-decisions/:id/set-default] failed:', error)
    return NextResponse.json({ error: 'Failed to set default' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return POST(request, ctx)
}
