export const maxDuration = 300 // 5 min — can iterate many items

import { NextResponse } from 'next/server'
import { evaluateRules, logFiring } from '@/lib/services/stock-alerts'
import { sendAlertEmail } from '@/lib/services/notifications'
import { initializeSecrets } from '@/lib/aws-secrets'

/**
 * GET /api/cron/check-alerts
 * Scheduled job: evaluate all enabled alert rules, dispatch notifications,
 * log firings. Called by App Runner cron / external scheduler.
 *
 * Read-only on Finansit.
 */
export async function GET() {
  try {
    await initializeSecrets()
    const firings = await evaluateRules()
    let sent = 0
    let failed = 0
    for (const f of firings) {
      const result =
        f.channel === 'email' || !f.channel
          ? await sendAlertEmail(f)
          : { ok: false, error: `unsupported channel: ${f.channel}` }
      if (result.ok) sent++
      else failed++
      await logFiring(f, result.ok, result.error || null)
    }
    return NextResponse.json({
      evaluated: firings.length,
      sent,
      failed,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 },
    )
  }
}
