import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import {
  getAllLambdaStatuses,
  resetLambdaStatus,
  hasServiceIssues,
  setLambdaEnabled,
  type ServiceName,
} from '@/lib/chat-admin/monitoring'

export const dynamic = 'force-dynamic'

const VALID: ServiceName[] = ['psa', 'partslink', 'vin17', 'qipei', 'saic']

/** GET /api/admin/lambda-status */
export async function GET() {
  try {
    await initializeSecrets()
    const [statuses, issues] = await Promise.all([getAllLambdaStatuses(), hasServiceIssues()])
    return NextResponse.json({
      success: true,
      statuses,
      summary: {
        total: statuses.length,
        healthy: statuses.filter((s) => s.status === 'healthy').length,
        degraded: statuses.filter((s) => s.status === 'degraded').length,
        down: statuses.filter((s) => s.status === 'down').length,
        unknown: statuses.filter((s) => s.status === 'unknown').length,
        hasIssues: issues.hasIssues,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

/** POST /api/admin/lambda-status — reset a service status */
export async function POST(request: NextRequest) {
  try {
    await initializeSecrets()
    const { serviceName } = await request.json()
    if (!serviceName || !VALID.includes(serviceName)) {
      return NextResponse.json(
        { success: false, error: `Invalid serviceName. Must be one of: ${VALID.join(', ')}` },
        { status: 400 },
      )
    }
    const status = await resetLambdaStatus(serviceName as ServiceName)
    return NextResponse.json({ success: true, status, message: `Service ${serviceName} status reset to unknown` })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

/** PATCH /api/admin/lambda-status — enable/disable a service */
export async function PATCH(request: NextRequest) {
  try {
    await initializeSecrets()
    const { serviceName, enabled } = await request.json()
    if (!serviceName || !VALID.includes(serviceName)) {
      return NextResponse.json(
        { success: false, error: `Invalid serviceName. Must be one of: ${VALID.join(', ')}` },
        { status: 400 },
      )
    }
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ success: false, error: 'enabled must be a boolean' }, { status: 400 })
    }
    await setLambdaEnabled(serviceName as ServiceName, enabled)
    return NextResponse.json({ success: true, message: `Service ${serviceName} ${enabled ? 'enabled' : 'disabled'}` })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
