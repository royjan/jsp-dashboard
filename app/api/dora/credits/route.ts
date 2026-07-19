import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/dora/credits — Dora's supplier-credit cases (זיכויים והחזרות).
 *
 * Source: Neon schema `dora` — a real-time trigger mirror of Dora's local
 * brain DB (LXC 104), so this reflects her case tracking within seconds.
 */
export async function GET() {
  try {
    await initializeSecrets()
    const res = await query(
      `SELECT id, external_ref, title, status, owner, notes, metadata,
              created_at, updated_at, follow_up_at, closed_at
         FROM dora.brain_tasks
        WHERE category = 'supplier_credit'
        ORDER BY updated_at DESC
        LIMIT 500`
    )
    return NextResponse.json({ success: true, cases: res.rows })
  } catch (e) {
    console.error('[dora/credits]', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
