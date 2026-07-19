import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { listDiegoSessions, getDiegoSession, deleteDiegoSession } from '@/lib/chat-admin/diego-sessions'

export const dynamic = 'force-dynamic'

/**
 * GET /api/diego/sessions            -> session list (newest first)
 * GET /api/diego/sessions?user=&id=  -> one session with its full event timeline
 */
export async function GET(req: NextRequest) {
  try {
    await initializeSecrets()
    const user = req.nextUrl.searchParams.get('user')
    const id = req.nextUrl.searchParams.get('id')
    if (user && id) {
      const session = await getDiegoSession(user, id)
      if (!session) return NextResponse.json({ success: false, error: 'not found' }, { status: 404 })
      return NextResponse.json({ success: true, session })
    }
    const sessions = await listDiegoSessions()
    return NextResponse.json({ success: true, sessions })
  } catch (e) {
    console.error('[diego/sessions]', e)
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

/** DELETE /api/diego/sessions?user=&id= — hard-delete a session + its events. */
export async function DELETE(req: NextRequest) {
  try {
    await initializeSecrets()
    const user = req.nextUrl.searchParams.get('user')
    const id = req.nextUrl.searchParams.get('id')
    if (!user || !id) {
      return NextResponse.json({ success: false, error: 'user and id required' }, { status: 400 })
    }
    const deleted = await deleteDiegoSession(user, id)
    return NextResponse.json({ success: true, deleted })
  } catch (e) {
    console.error('[diego/sessions delete]', e)
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
