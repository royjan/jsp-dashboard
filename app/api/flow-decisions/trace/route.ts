import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { simulateTrace, type TraceStatus } from '@/lib/chat-admin/flow-decisions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface TraceRequest {
  partDescription: string
  vin?: string
  licensePlate?: string
  vehicleData?: { year?: number; model?: string; fuelType?: string; engineModel?: string }
  includeStatuses?: TraceStatus[]
  nearMissFloor?: number
  threshold?: number
}

/**
 * POST /api/flow-decisions/trace — Observatory decision tracer.
 * Superset of /simulate: returns term-expansion, per-candidate cosine + vehicle
 * scores, near-misses, non-approved lanes, the pinned direct_part, and the
 * discrete production verdict (so simulator-vs-production disagreement is visible).
 */
export async function POST(request: NextRequest) {
  try {
    await initializeSecrets()
    const body: TraceRequest = await request.json()
    const { partDescription, vin, licensePlate, vehicleData, includeStatuses, nearMissFloor, threshold } = body
    if (!partDescription) {
      return NextResponse.json({ error: 'Part description is required' }, { status: 400 })
    }
    const vehicleNote =
      vin || licensePlate
        ? 'VIN/license-plate decode is not available in the dashboard — enter vehicle fields manually.'
        : undefined

    const result = await simulateTrace(partDescription, vehicleData || {}, { includeStatuses, nearMissFloor, threshold })

    return NextResponse.json({
      partDescription,
      vehicleData: vehicleData || {},
      vehicleNote,
      ...result,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[flow-decisions/trace] failed:', error)
    return NextResponse.json(
      { error: 'Trace failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
