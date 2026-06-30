import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getAllFlowDecisions, createFlowDecision, updateFlowDecision } from '@/lib/chat-admin/flow-decisions'
import type { FlowDecisionStatus } from '@/types/chat-admin/flow-decision'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const VALID_STATUS = ['suggestion', 'approved', 'rejected']

/** GET /api/flow-decisions?page=&pageSize=&status=&search=&orderBy=&orderDirection= */
export async function GET(request: NextRequest) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const rawStatus = searchParams.get('status')
    const rawOrderBy = searchParams.get('orderBy')
    const result = await getAllFlowDecisions({
      page: parseInt(searchParams.get('page') || '1'),
      pageSize: parseInt(searchParams.get('pageSize') || '50'),
      search: searchParams.get('search')?.trim().substring(0, 255) || undefined,
      status: rawStatus && VALID_STATUS.includes(rawStatus) ? (rawStatus as FlowDecisionStatus) : undefined,
      orderBy: ['createdAt', 'updatedAt', 'partDescription'].includes(rawOrderBy || '')
        ? (rawOrderBy as 'createdAt' | 'updatedAt' | 'partDescription')
        : 'createdAt',
      orderDirection: searchParams.get('orderDirection') === 'asc' ? 'asc' : 'desc',
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[flow-decisions] GET failed:', error)
    return NextResponse.json({ error: 'Failed to fetch flow decisions' }, { status: 500 })
  }
}

/** POST /api/flow-decisions — create */
export async function POST(request: NextRequest) {
  try {
    await initializeSecrets()
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
    }
    const { partDescription, flowDecision, lambdaTarget, metadata, status, createdBy, vehicleFilters, directPart } = body
    if (!partDescription || !flowDecision) {
      return NextResponse.json({ error: 'Missing required fields: partDescription, flowDecision' }, { status: 400 })
    }
    const { category, subcategory, schema } = flowDecision
    if (!category || !subcategory || !schema) {
      return NextResponse.json({ error: 'Flow decision must include category, subcategory, and schema' }, { status: 400 })
    }
    if (!partDescription.trim()) {
      return NextResponse.json({ error: 'Part description cannot be empty' }, { status: 400 })
    }
    const record = await createFlowDecision({
      partDescription,
      category,
      subcategory,
      schema,
      lambdaTarget: lambdaTarget || 'partslink',
      status: status || 'suggestion',
      metadata,
      createdBy: createdBy || undefined,
      vehicleFilters,
      directPart,
    })
    return NextResponse.json(record, { status: 201 })
  } catch (error) {
    console.error('[flow-decisions] POST failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create flow decision' }, { status: 500 })
  }
}

/** PUT /api/flow-decisions — update (body includes id) */
export async function PUT(request: NextRequest) {
  try {
    await initializeSecrets()
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
    }
    const { id, partDescription, flowDecision, lambdaTarget, vehicleFilters, status, metadata, directPart } = body
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const updated = await updateFlowDecision(id, {
      partDescription,
      category: flowDecision?.category,
      subcategory: flowDecision?.subcategory,
      schema: flowDecision?.schema,
      lambdaTarget,
      vehicleFilters,
      status,
      metadata,
      directPart,
    })
    if (!updated) return NextResponse.json({ error: 'Flow decision not found' }, { status: 404 })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('[flow-decisions] PUT failed:', error)
    return NextResponse.json({ error: 'Failed to update flow decision' }, { status: 500 })
  }
}
