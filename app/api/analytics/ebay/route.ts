export const maxDuration = 30

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'

export async function GET() {
  try {
    await initializeSecrets()

    const [itemStats, batchStats, recStats, recentListings, stockAlerts] = await Promise.all([
      // Item KPIs
      query(`
        SELECT
          COUNT(*)::int AS total_items,
          COUNT(*) FILTER (WHERE upload_status = 'success')::int AS listed_count,
          COUNT(*) FILTER (WHERE upload_status = 'pending')::int AS pending_count,
          COUNT(*) FILTER (WHERE upload_status = 'error')::int AS error_count,
          COALESCE(SUM(price * quantity) FILTER (WHERE upload_status = 'success'), 0)::real AS total_listed_value,
          COALESCE(SUM(quantity) FILTER (WHERE upload_status = 'success'), 0)::int AS total_listed_qty
        FROM ebay_uploader.items
      `),
      // Batch KPIs
      query(`
        SELECT
          COUNT(*)::int AS total_batches,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_batches,
          COUNT(*) FILTER (WHERE status = 'draft')::int AS draft_batches,
          COALESCE(SUM(uploaded_items), 0)::int AS total_uploaded,
          COALESCE(SUM(failed_items), 0)::int AS total_failed
        FROM ebay_uploader.batches
      `),
      // Recommendation pipeline
      query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
          COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
          COUNT(*) FILTER (WHERE status = 'listed')::int AS listed,
          ROUND(AVG(score))::int AS avg_score
        FROM ebay_uploader.recommendations
      `),
      // Recent listings (last 50)
      query(`
        SELECT
          i.id, i.sku, i.title, i.price, i.currency, i.quantity,
          i.upload_status, i.ebay_listing_id, i.brand, i.category_name,
          i.created_at, i.error_message,
          b.name AS batch_name
        FROM ebay_uploader.items i
        LEFT JOIN ebay_uploader.batches b ON i.batch_id = b.id
        ORDER BY i.created_at DESC
        LIMIT 50
      `),
      // Stock alerts: listed on eBay but stock might be 0
      query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_updates,
          COUNT(*) FILTER (WHERE update_type = 'stock_zero')::int AS zero_stock_alerts,
          COUNT(*) FILTER (WHERE update_type = 'price_change')::int AS price_change_alerts
        FROM ebay_uploader.listing_updates
      `),
    ])

    return NextResponse.json({
      items: itemStats.rows[0],
      batches: batchStats.rows[0],
      recommendations: recStats.rows[0],
      recent_listings: recentListings.rows,
      stock_alerts: stockAlerts.rows[0],
    })
  } catch (error) {
    console.error('[eBay Analytics] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}
