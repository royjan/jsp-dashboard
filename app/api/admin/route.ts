import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * GET /api/admin?type=conversations|feedback
 * Feeds the analytics dashboard from the shared chat_history / feedback tables.
 */
export async function GET(request: NextRequest) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const limit = Math.min(parseInt(searchParams.get('limit') || '2000'), 5000)

    if (type === 'conversations') {
      const res = await query(
        `SELECT id, conversation_id, user_id, messages, metadata, intent, created_at
         FROM chat_history ORDER BY created_at DESC LIMIT $1`,
        [limit],
      )
      const conversations = res.rows.map((r: any) => {
        const messages = Array.isArray(r.messages) ? r.messages : []
        return {
          id: r.id,
          conversationId: r.conversation_id,
          userId: r.user_id,
          userEmail: r.metadata?.user_email ?? r.metadata?.userEmail ?? null,
          title: r.metadata?.title ?? messages[0]?.content?.slice?.(0, 60) ?? null,
          intent: r.intent,
          messages,
          messageCount: messages.length,
          createdAt: r.created_at,
        }
      })
      return NextResponse.json({ conversations })
    }

    if (type === 'feedback') {
      const res = await query(
        `SELECT id, conversation_id, message_id, user_id, type, metadata, created_at
         FROM feedback ORDER BY created_at DESC LIMIT $1`,
        [limit],
      )
      const feedback = res.rows.map((r: any) => ({
        id: r.id,
        conversationId: r.conversation_id,
        messageId: r.message_id,
        userId: r.user_id,
        type: r.type,
        feedbackType: r.type,
        metadata: r.metadata,
        createdAt: r.created_at,
      }))
      return NextResponse.json({ feedback })
    }

    return NextResponse.json({ error: 'Missing or invalid type (conversations|feedback)' }, { status: 400 })
  } catch (error) {
    console.error('Error in /api/admin:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
