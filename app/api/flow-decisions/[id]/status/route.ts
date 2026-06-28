import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { updateStatus } from '@/lib/chat-admin/flow-decisions'
import type { FlowDecisionStatus } from '@/types/chat-admin/flow-decision'

export const dynamic = 'force-dynamic'

const VALID: FlowDecisionStatus[] = ['suggestion', 'approved', 'rejected']

/** PUT /api/flow-decisions/[id]/status — { status } */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initializeSecrets()
    const { id } = await params
    const { status } = await request.json()
    if (!status || !VALID.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    const updated = await updateStatus(id, status)
    if (!updated) return NextResponse.json({ error: 'Flow decision not found' }, { status: 404 })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('[flow-decisions/:id/status] failed:', error)
    return NextResponse.json({ error: 'Failed to update flow decision status' }, { status: 500 })
  }
}
