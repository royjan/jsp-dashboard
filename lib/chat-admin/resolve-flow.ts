/**
 * Resolve a flow's catalog path (category / subcategory / schema) from a part id.
 *
 * Two tiers:
 *  1. FAST — if the part id is already pinned on a (non-rejected) flow_decision, reuse its
 *     catalog path instantly. No external call.
 *  2. FALLBACK — otherwise invoke the PSA `flow_lookup` lambda ({vin, flow_lookup:[partId]}),
 *     which navigates the live catalog. Needs a VIN and can take up to ~90s (cold session).
 */
import { and, desc, eq, ne } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { flowDecisionsV2, directParts } from '@/lib/db/schema'

const PSA_LAMBDA_NAME = process.env.PSA_LAMBDA_NAME || 'psa-vehicle-service-lambda-dev-api'
const PSA_LAMBDA_REGION = process.env.PSA_LAMBDA_REGION || 'eu-west-3'

export interface ResolvedFlow {
  found: boolean
  source?: 'cache' | 'lambda'
  category?: string
  subcategory?: string
  schema?: string
  name?: string | null
  needsVin?: boolean
  error?: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function resolveFlowByPartId(partId: string, vin?: string): Promise<ResolvedFlow> {
  const pid = (partId || '').trim()
  if (!pid) return { found: false, error: 'part id is required' }

  // 1) Fast path — the part is already pinned somewhere, reuse that catalog path.
  const db = await getDb()
  const [hit] = await db
    .select({
      category: flowDecisionsV2.category,
      subcategory: flowDecisionsV2.subcategory,
      schema: flowDecisionsV2.schema,
      name: directParts.name,
    })
    .from(directParts)
    .innerJoin(flowDecisionsV2, eq(flowDecisionsV2.id, directParts.flowDecisionId))
    .where(and(eq(directParts.partId, pid), ne(flowDecisionsV2.status, 'rejected')))
    .orderBy(desc(flowDecisionsV2.updatedAt))
    .limit(1)
  if (hit) {
    return { found: true, source: 'cache', category: hit.category, subcategory: hit.subcategory, schema: hit.schema, name: hit.name }
  }

  // 2) Fallback — live PSA catalog lookup (requires a VIN).
  const v = (vin || '').trim()
  if (!v) return { found: false, needsVin: true }
  try {
    const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda')
    const client = new LambdaClient({ region: PSA_LAMBDA_REGION })
    const resp = await client.send(new InvokeCommand({
      FunctionName: PSA_LAMBDA_NAME,
      Payload: Buffer.from(JSON.stringify({ vin: v, flow_lookup: [pid] })),
    }))
    const body = JSON.parse(Buffer.from(resp.Payload ?? new Uint8Array()).toString() || '{}')
    const flow = (body.flows || []).find((f: any) => String(f.part_id) === pid)
    const matches: any[] = flow?.matches || []
    // Prefer a canonical '<group> - <subgroup>' subcategory, else the first match.
    const best = matches.find(m => (m.subcategory || '').includes(' - ')) || matches[0]
    if (!best) return { found: false, error: 'Part not found in the catalog for this VIN.' }
    return { found: true, source: 'lambda', category: best.category, subcategory: best.subcategory, schema: best.schema }
  } catch (e: any) {
    return { found: false, error: e?.message || 'PSA lookup failed.' }
  }
}

/** Ground-truth verify: FORCE the PSA lambda (skip the cache) so we can compare a rule's
 *  schema against what PSA actually says the part belongs to. Returns all matched schemas. */
export async function verifyPartSchemaViaPsa(
  partId: string,
  vin: string,
): Promise<{ found: boolean; schemas?: string[]; matches?: any[]; error?: string }> {
  const pid = (partId || '').trim()
  const v = (vin || '').trim()
  if (!pid) return { found: false, error: 'part id required' }
  if (!v) return { found: false, error: 'VIN required to verify against PSA' }
  try {
    const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda')
    const client = new LambdaClient({ region: PSA_LAMBDA_REGION })
    const resp = await client.send(new InvokeCommand({
      FunctionName: PSA_LAMBDA_NAME,
      Payload: Buffer.from(JSON.stringify({ vin: v, flow_lookup: [pid] })),
    }))
    const body = JSON.parse(Buffer.from(resp.Payload ?? new Uint8Array()).toString() || '{}')
    const flow = (body.flows || []).find((f: any) => String(f.part_id) === pid)
    const schemas = ((flow?.matches as any[]) || []).map((m) => m.schema).filter(Boolean)
    return { found: !!flow?.found && schemas.length > 0, schemas, matches: flow?.matches || [] }
  } catch (e: any) {
    return { found: false, error: e?.message || 'PSA lookup failed.' }
  }
}
