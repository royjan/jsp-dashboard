export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { getIcsStats } from '@/lib/ics-stats'

export async function GET() {
  try {
    await initializeSecrets()
    const today = new Date().toISOString().split('T')[0]

    const [chatKpis, ebayKpis, marketKpis] = await Promise.allSettled([
      // Chat KPIs (from search_analytics — same Neon DB)
      query(`
        SELECT
          COUNT(*) FILTER (WHERE DATE(created_at) = $1)::int AS conversations_today,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS conversations_week,
          (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE type = 'thumbs_up') /
            NULLIF(COUNT(*) FILTER (WHERE type IN ('thumbs_up', 'thumbs_down')), 0), 1)
           FROM feedback WHERE created_at >= NOW() - INTERVAL '7 days') AS satisfaction_rate,
          ROUND(100.0 * COUNT(*) FILTER (WHERE has_results = false AND created_at >= NOW() - INTERVAL '7 days') /
            NULLIF(COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days'), 0), 1) AS zero_result_rate
        FROM search_analytics
      `, [today]),

      // eBay KPIs (from ebay_uploader schema — same Neon DB)
      query(`
        SELECT
          (SELECT COUNT(*)::int FROM ebay_uploader.items WHERE upload_status = 'success') AS active_listings,
          (SELECT COUNT(*)::int FROM ebay_uploader.recommendations WHERE status = 'pending') AS pending_recommendations,
          (SELECT COUNT(*)::int FROM ebay_uploader.listing_updates WHERE status = 'pending') AS stock_alerts
      `),

      // Market KPIs. This tile is one number on a busy overview page, so it
      // reads the cache only: getIcsStats() returns null rather than blocking
      // this request behind a 10s scan, and the tile shows 0 until the cron
      // (or the /vehicle-intelligence page) has warmed it.
      getIcsStats()
        .then(d => ({ total_vehicles: d?.overview?.totalVehicles || 0 }))
        .catch(() => ({ total_vehicles: 0 })),
    ])

    return NextResponse.json({
      chat: chatKpis.status === 'fulfilled' ? (chatKpis.value.rows[0] || {}) : {},
      ebay: ebayKpis.status === 'fulfilled' ? (ebayKpis.value.rows[0] || {}) : {},
      market: marketKpis.status === 'fulfilled' ? marketKpis.value : {},
    })
  } catch (error) {
    console.error('[Cross-Platform KPIs] Error:', error)
    return NextResponse.json({ chat: {}, ebay: {}, market: {} })
  }
}
