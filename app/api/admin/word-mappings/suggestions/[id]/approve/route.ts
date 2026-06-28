import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { approveSuggestion } from '@/lib/chat-admin/word-mappings'

export const dynamic = 'force-dynamic'

/** POST /api/admin/word-mappings/suggestions/[id]/approve */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initializeSecrets()
    const { id } = await params
    let body
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    await approveSuggestion(id, body.reviewedBy || 'admin')
    return NextResponse.json({ success: true, message: 'Suggestion approved successfully' })
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 })
    }
    console.error('Error approving suggestion:', error)
    return NextResponse.json({ error: 'Failed to approve suggestion' }, { status: 500 })
  }
}
