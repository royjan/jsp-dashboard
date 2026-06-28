import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { simulate } from '@/lib/chat-admin/flow-decisions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface SimulateRequest {
  partDescription: string
  vin?: string
  licensePlate?: string
  vehicleData?: { year?: number; model?: string; fuelType?: string; engineModel?: string }
}

/**
 * POST /api/flow-decisions/simulate
 * v1: vector-search simulator from a typed description + manual vehicle data.
 * VIN / license-plate decode is deferred (returns a note), since it requires
 * the chat vehicle Lambda services that are out of scope for the dashboard.
 */
export async function POST(request: NextRequest) {
  try {
    await initializeSecrets()
    const body: SimulateRequest = await request.json()
    const { partDescription, vin, licensePlate, vehicleData } = body
    if (!partDescription) {
      return NextResponse.json({ error: 'Part description is required' }, { status: 400 })
    }

    const vehicleNote =
      vin || licensePlate
        ? 'VIN/license-plate decode is not available in the dashboard — enter vehicle fields manually.'
        : undefined

    const result = await simulate(partDescription, vehicleData || {})

    if (!result.ok) {
      return NextResponse.json({
        success: false,
        partDescription,
        error: result.reason,
        bestMatch: null,
        allCandidates: [],
        matchType: result.matchType,
        vehicleNote,
        timestamp: new Date().toISOString(),
      })
    }

    return NextResponse.json({
      success: true,
      partDescription,
      vehicleData: vehicleData || {},
      bestMatch: result.bestMatch,
      allCandidates: result.allCandidates,
      matchType: result.matchType,
      vehicleNote,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[flow-decisions/simulate] failed:', error)
    return NextResponse.json(
      { error: 'Simulation failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
