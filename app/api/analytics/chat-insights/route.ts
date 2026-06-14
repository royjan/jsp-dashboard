export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '30', 10)
    const cutoff = new Date(Date.now() - days * 86400000).toISOString()

    const [conversationStats, feedbackStats, intentBreakdown, dailyActivity, topUsers] = await Promise.all([
      // Conversation KPIs
      query(`
        SELECT
          COUNT(*)::int AS total_conversations,
          COUNT(DISTINCT user_id)::int AS unique_users,
          COUNT(*) FILTER (WHERE intent IS NOT NULL)::int AS classified_conversations
        FROM chat_history
        WHERE created_at >= $1
      `, [cutoff]),

      // Feedback summary
      query(`
        SELECT
          COUNT(*)::int AS total_feedback,
          COUNT(*) FILTER (WHERE type = 'thumbs_up')::int AS thumbs_up,
          COUNT(*) FILTER (WHERE type = 'thumbs_down')::int AS thumbs_down,
          COUNT(*) FILTER (WHERE type = 'found')::int AS found_count,
          ROUND(100.0 * COUNT(*) FILTER (WHERE type = 'thumbs_up') /
            NULLIF(COUNT(*) FILTER (WHERE type IN ('thumbs_up', 'thumbs_down')), 0), 1) AS satisfaction_rate
        FROM feedback
        WHERE created_at >= $1
      `, [cutoff]),

      // Intent distribution from search analytics
      query(`
        SELECT
          intent,
          COUNT(*)::int AS count,
          ROUND(AVG(response_time_ms))::int AS avg_response_ms,
          ROUND(100.0 * COUNT(*) FILTER (WHERE has_results = true) / NULLIF(COUNT(*), 0), 1) AS success_rate
        FROM search_analytics
        WHERE created_at >= $1
        GROUP BY intent
        ORDER BY count DESC
        LIMIT 15
      `, [cutoff]),

      // Daily activity (conversations per day)
      query(`
        SELECT
          DATE(created_at) AS day,
          COUNT(*)::int AS conversations,
          COUNT(DISTINCT user_id)::int AS users
        FROM chat_history
        WHERE created_at >= $1
        GROUP BY DATE(created_at)
        ORDER BY day DESC
        LIMIT 30
      `, [cutoff]),

      // Top users by conversation count, resolved to name/email via auth_sessions
      query(`
        SELECT
          ch.user_id,
          COALESCE(au.user_name, au.user_email, ch.user_id) AS display_name,
          au.user_email AS email,
          COUNT(*)::int AS conversation_count,
          MAX(ch.last_user_message_at)::text AS last_active
        FROM chat_history ch
        LEFT JOIN (
          SELECT DISTINCT ON (user_id) user_id, user_email, user_name
          FROM auth_sessions
          WHERE user_id IS NOT NULL
          ORDER BY user_id, updated_at DESC NULLS LAST
        ) au ON au.user_id = ch.user_id
        WHERE ch.created_at >= $1 AND ch.user_id IS NOT NULL
        GROUP BY ch.user_id, au.user_name, au.user_email
        ORDER BY conversation_count DESC
        LIMIT 20
      `, [cutoff]),
    ])

    return NextResponse.json({
      conversations: conversationStats.rows[0],
      feedback: feedbackStats.rows[0],
      intents: intentBreakdown.rows,
      daily_activity: dailyActivity.rows,
      top_users: topUsers.rows,
    })
  } catch (error) {
    console.error('[Chat Insights] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}
