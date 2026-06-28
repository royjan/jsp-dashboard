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

    const [
      conversationStats, feedbackStats, intentBreakdown, dailyActivity, topUsers,
      partsBot, topNotFound, byLambda, flowDecisionStats, recentPins,
    ] = await Promise.all([
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

      // Intent distribution from search analytics (the LLM router's classification)
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

      // ── Diego parts-bot search stats (source='telegram_bot') ──
      query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE has_results = false)::int AS not_found,
          COUNT(*) FILTER (WHERE has_results = true AND metadata->>'oos' = 'true')::int AS oos,
          COUNT(*) FILTER (WHERE has_results = true AND COALESCE(metadata->>'oos','') <> 'true')::int AS in_stock,
          COUNT(*) FILTER (WHERE metadata->>'flow_decision_source' = 'pg')::int AS deterministic,
          COUNT(DISTINCT user_id)::int AS users,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY response_time_ms)::int AS p50,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)::int AS p95
        FROM search_analytics
        WHERE source = 'telegram_bot' AND created_at >= $1
      `, [cutoff]),

      // Top not-found queries (Diego)
      query(`
        SELECT query, COUNT(*)::int AS count
        FROM search_analytics
        WHERE source = 'telegram_bot' AND has_results = false AND created_at >= $1
        GROUP BY query ORDER BY count DESC LIMIT 15
      `, [cutoff]),

      // Per-portal (lambda) breakdown
      query(`
        SELECT
          COALESCE(metadata->>'lambda_type', 'unknown') AS lambda,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE has_results = false)::int AS not_found
        FROM search_analytics
        WHERE source = 'telegram_bot' AND created_at >= $1
        GROUP BY 1 ORDER BY count DESC
      `, [cutoff]),

      // Flow decisions (learned pins) — counts by source + status
      query(`
        SELECT source, status, COUNT(*)::int AS count
        FROM flow_decisions_v2
        GROUP BY source, status ORDER BY count DESC
      `),

      // Recent approved flow decisions
      query(`
        SELECT part_description, schema, lambda_target, source, status,
               vehicle_model, created_at::text
        FROM flow_decisions_v2
        WHERE status = 'approved'
        ORDER BY created_at DESC LIMIT 20
      `),
    ])

    return NextResponse.json({
      conversations: conversationStats.rows[0],
      feedback: feedbackStats.rows[0],
      intents: intentBreakdown.rows,
      daily_activity: dailyActivity.rows,
      top_users: topUsers.rows,
      parts_bot: partsBot.rows[0],
      top_not_found: topNotFound.rows,
      by_lambda: byLambda.rows,
      flow_decisions: flowDecisionStats.rows,
      recent_pins: recentPins.rows,
    })
  } catch (error) {
    console.error('[Chat Insights] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}
