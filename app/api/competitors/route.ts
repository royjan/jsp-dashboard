export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'

// Competitor list with latest-snapshot stats (for filter chips / uploads panel).
export async function GET() {
  try {
    await initializeSecrets()
    const { rows } = await query(`
      SELECT c.id, c.name, c.display_name, c.active,
             u.uploaded_at AS last_upload_at,
             (SELECT count(*) FROM dashboard.competitor_items ci WHERE ci.upload_id = c.latest_upload_id AND ci.competitor_id = c.id) AS item_count
      FROM dashboard.competitors c
      LEFT JOIN dashboard.competitor_uploads u ON u.id = c.latest_upload_id
      ORDER BY c.name
    `)
    return NextResponse.json({ competitors: rows })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}
