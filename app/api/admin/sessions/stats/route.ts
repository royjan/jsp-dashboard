import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { getMaxConcurrent, type LambdaType } from '@/lib/chat-admin/queue-config'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

const LAMBDAS: LambdaType[] = ['psa', 'partslink', 'vin17', 'qipei']

/** GET /api/admin/sessions/stats — QueueStats from search_tracking */
export async function GET() {
  const emptyType = () =>
    Object.fromEntries(
      LAMBDAS.map((t) => [
        t,
        { activeCount: 0, queuedCount: 0, maxConcurrent: getMaxConcurrent(t), avgDurationMs: 0 },
      ]),
    )

  try {
    await initializeSecrets()
    const res = await query(`
      SELECT COALESCE(lambda_type,'partslink') lambda_type,
             COUNT(*) FILTER (WHERE status='processing') active,
             COUNT(*) FILTER (WHERE status='queued') queued,
             COUNT(*) FILTER (WHERE status='completed' AND created_at >= NOW() - INTERVAL '24 hours') completed24,
             COUNT(*) FILTER (WHERE status='failed' AND created_at >= NOW() - INTERVAL '24 hours') failed24,
             AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL) avg_ms
      FROM search_tracking
      GROUP BY 1
    `)

    const byLambdaType: any = emptyType()
    let active = 0, queued = 0, completed = 0, failed = 0, durSum = 0, durN = 0
    for (const r of res.rows as any[]) {
      const t = (LAMBDAS.includes(r.lambda_type) ? r.lambda_type : 'partslink') as LambdaType
      const a = Number(r.active), q = Number(r.queued)
      const avg = Number(r.avg_ms ?? 0)
      byLambdaType[t] = {
        activeCount: a,
        queuedCount: q,
        maxConcurrent: getMaxConcurrent(t),
        avgDurationMs: Math.round(avg),
      }
      active += a
      queued += q
      completed += Number(r.completed24)
      failed += Number(r.failed24)
      if (avg) { durSum += avg; durN++ }
    }

    const successRate = completed + failed > 0 ? (completed / (completed + failed)) * 100 : 100
    return NextResponse.json({
      byLambdaType,
      total: {
        activeCount: active,
        queuedCount: queued,
        completedLast24h: completed,
        failedLast24h: failed,
        avgDurationMs: durN > 0 ? Math.round(durSum / durN) : 0,
        successRate,
      },
    })
  } catch (error) {
    console.error('Error computing queue stats:', error)
    return NextResponse.json({
      byLambdaType: emptyType(),
      total: { activeCount: 0, queuedCount: 0, completedLast24h: 0, failedLast24h: 0, avgDurationMs: 0, successRate: 100 },
    })
  }
}
