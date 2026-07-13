import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { simulateTrace, resolveVehicleByPlateOrVin, type TraceStatus } from '@/lib/chat-admin/flow-decisions'

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
    // Decode plate/VIN from car_records (like Diego), filling any vehicle fields not typed manually.
    let vehicle = { ...(vehicleData || {}) }
    let resolvedVehicle: any = null
    let vehicleNote: string | undefined
    if (licensePlate || vin) {
      resolvedVehicle = await resolveVehicleByPlateOrVin(licensePlate || vin || '')
      if (resolvedVehicle) {
        vehicle = {
          year: vehicle.year ?? resolvedVehicle.year,
          model: vehicle.model ?? resolvedVehicle.model,
          fuelType: vehicle.fuelType ?? resolvedVehicle.fuelType,
          engineModel: vehicle.engineModel ?? resolvedVehicle.engineModel,
        }
      } else {
        vehicleNote = `לא נמצא רכב עבור ${licensePlate || vin} ב-car_records — הזן נתוני רכב ידנית.`
      }
    }

    const result = await simulateTrace(partDescription, vehicle, { includeStatuses, nearMissFloor, threshold })

    return NextResponse.json({
      partDescription,
      vehicleData: vehicle,
      resolvedVehicle,
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
