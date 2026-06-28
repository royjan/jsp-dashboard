import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

function rowToSearch(r: any) {
  return {
    searchId: r.search_id,
    userId: r.user_id,
    userEmail: r.user_email,
    conversationId: r.conversation_id,
    vin: r.vin,
    licensePlate: r.license_plate,
    lambdaType: r.lambda_type,
    status: r.status,
    queuePosition: r.queue_position,
    partsFound: r.parts_found,
    errorMessage: r.error_message,
    createdAt: r.created_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    durationMs: r.duration_ms,
  }
}

/** GET /api/admin/sessions — live queue state from search_tracking */
export async function GET() {
  try {
    await initializeSecrets()
    const [active, queued, recent] = await Promise.all([
      query(`SELECT * FROM search_tracking WHERE status = 'processing' ORDER BY started_at DESC NULLS LAST LIMIT 50`),
      query(`SELECT * FROM search_tracking WHERE status = 'queued' ORDER BY queue_position ASC NULLS LAST, created_at ASC LIMIT 50`),
      query(`SELECT * FROM search_tracking WHERE status IN ('completed','failed','cancelled') ORDER BY created_at DESC LIMIT 30`),
    ])
    return NextResponse.json({
      active: active.rows.map(rowToSearch),
      queued: queued.rows.map(rowToSearch),
      recent: recent.rows.map(rowToSearch),
    })
  } catch (error) {
    console.error('Error fetching sessions:', error)
    return NextResponse.json({ active: [], queued: [], recent: [] })
  }
}

/** POST /api/admin/sessions — { action: 'cancel', searchId } */
export async function POST(request: NextRequest) {
  try {
    await initializeSecrets()
    const { action, searchId } = await request.json()
    if (action !== 'cancel' || !searchId) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const res = await query(
      `UPDATE search_tracking SET status = 'cancelled', completed_at = NOW()
       WHERE search_id = $1 AND status IN ('queued','processing')`,
      [searchId],
    )
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Search not found or not cancellable' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error cancelling search:', error)
    return NextResponse.json({ error: 'Failed to cancel search' }, { status: 500 })
  }
}
