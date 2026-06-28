import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getFlowDecisionById, deleteFlowDecision } from '@/lib/chat-admin/flow-decisions'

export const dynamic = 'force-dynamic'

/** GET /api/flow-decisions/[id] */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initializeSecrets()
    const { id } = await params
    const record = await getFlowDecisionById(id)
    if (!record) return NextResponse.json({ error: 'Flow decision not found' }, { status: 404 })
    return NextResponse.json(record)
  } catch (error) {
    console.error('[flow-decisions/:id] GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch flow decision' }, { status: 500 })
  }
}

/** DELETE /api/flow-decisions/[id] */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initializeSecrets()
    const { id } = await params
    const ok = await deleteFlowDecision(id)
    if (!ok) return NextResponse.json({ error: 'Flow decision not found' }, { status: 404 })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[flow-decisions/:id] DELETE failed:', error)
    return NextResponse.json({ error: 'Failed to delete flow decision' }, { status: 500 })
  }
}
