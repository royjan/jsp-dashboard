import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { approveSuggestion, rejectSuggestion } from '@/lib/chat-admin/word-mappings'

export const dynamic = 'force-dynamic'

interface BulkActionRequest {
  action: 'approve' | 'reject'
  ids: string[]
  reason?: string
}

/** POST /api/admin/word-mappings/suggestions/bulk — bulk approve/reject */
export async function POST(req: NextRequest) {
  try {
    await initializeSecrets()
    const body: BulkActionRequest = await req.json()
    const { action, ids, reason } = body

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json({ error: 'Invalid action. Must be "approve" or "reject"' }, { status: 400 })
    }
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'No IDs provided' }, { status: 400 })
    }
    if (action === 'reject' && !reason) {
      return NextResponse.json({ error: 'Reason is required for rejection' }, { status: 400 })
    }

    const results: Array<{ id: string; success: boolean; error?: string }> = []
    let processed = 0
    let failed = 0

    for (const id of ids) {
      try {
        if (action === 'approve') await approveSuggestion(id, 'admin')
        else await rejectSuggestion(id, reason!, 'admin')
        processed++
        results.push({ id, success: true })
      } catch (error) {
        failed++
        results.push({ id, success: false, error: error instanceof Error ? error.message : 'Unknown error' })
      }
    }

    return NextResponse.json({ success: failed === 0, processed, failed, results })
  } catch (error) {
    console.error('Error in bulk word mapping suggestion action:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
