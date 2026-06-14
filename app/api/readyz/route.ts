import { NextResponse } from 'next/server'
import { getPool } from '@/lib/db'

export async function GET() {
  const checks: Record<string, 'ok' | 'error'> = {}

  // Check PostgreSQL
  try {
    const pool = await getPool()
    await pool.query('SELECT 1')
    checks.pg = 'ok'
  } catch {
    checks.pg = 'error'
  }

  // Check Redis (Upstash)
  try {
    const { getCached } = await import('@/lib/redis-client')
    await getCached('healthcheck')
    checks.redis = 'ok'
  } catch {
    checks.redis = 'error'
  }

  const allOk = Object.values(checks).every((v) => v === 'ok')

  return NextResponse.json(
    {
      status: allOk ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: allOk ? 200 : 503 },
  )
}
