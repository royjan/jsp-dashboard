import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { listDiegoSessions, getDiegoSession } from '@/lib/chat-admin/diego-sessions'

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
