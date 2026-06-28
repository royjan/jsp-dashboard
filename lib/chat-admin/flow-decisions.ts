/**
 * Flow-decisions data access for the integrated chat admin.
 * Ported from jsp-chat-js's FlowDecisionServicePG onto raw `query()` against the
 * shared `flow_decisions_v2` / `part_descriptions` tables (+ the
 * `flow_decisions_with_embeddings` view for the simulator). No Prisma.
 */

import { query, getPool } from '@/lib/db'
import { embedText, toVectorLiteral } from '@/lib/chat-admin/embeddings'
import type { FlowDecisionRecord, FlowDecisionStatus } from '@/types/chat-admin/flow-decision'

/* eslint-disable @typescript-eslint/no-explicit-any */

const normalizeDescription = (d: string) => (d || '').toLowerCase().trim()
const normalizeFilter = (v: any): string | null => {
  if (!v) return null
  const t = String(v).trim()
  if (!t || t.toLowerCase() === 'unknown') return null
  return t
}

/** Map a flow_decisions_v2 row (+ optional joined direct_part) to the UI record. */
export function rowToRecord(r: any): FlowDecisionRecord {
  const directPart = r.direct_part_id
    ? {
        id: r.direct_part_id,
        partId: r.dp_part_id,
        name: r.dp_name,
        imageUrl: r.dp_image_url,
        price: r.dp_price != null ? Number(r.dp_price) : undefined,
        currency: r.dp_currency || 'ILS',
        supplier: r.dp_supplier,
        inStock: r.dp_in_stock ?? true,
      }
    : undefined
  return {
    id: r.id,
    partDescription: r.part_description,
    flowDecision: { category: r.category, subcategory: r.subcategory, schema: r.schema },
    category: r.category,
    subcategory: r.subcategory,
    schema: r.schema,
    feedbackCount: r.feedback_count || 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    isDefault: r.is_default || false,
    createdBy: r.created_by,
    lambdaTarget: r.lambda_target,
    status: r.status,
    metadata: r.metadata,
    source: r.source,
    confidence: r.confidence != null ? Number(r.confidence) : null,
    approvedAt: r.approved_at,
    approvedBy: r.approved_by,
    rejectedAt: r.rejected_at,
    rejectedBy: r.rejected_by,
    rejectionReason: r.rejection_reason,
    vehicleYearFrom: r.vehicle_year_from,
    vehicleYearTo: r.vehicle_year_to,
    vehicleModel: r.vehicle_model,
    vehicleFuelType: r.vehicle_fuel_type,
    vehicleEngineModel: r.vehicle_engine_model,
    vinPattern: r.vin_pattern,
    vehicleFilters: {
      year:
        r.vehicle_year_from || r.vehicle_year_to
          ? `${r.vehicle_year_from || ''}-${r.vehicle_year_to || ''}`
          : undefined,
      yearFrom: r.vehicle_year_from,
      yearTo: r.vehicle_year_to,
      model: r.vehicle_model,
      fuelType: r.vehicle_fuel_type,
      engineModel: r.vehicle_engine_model,
      vinPattern: r.vin_pattern,
    },
    directPart,
  }
}

const SELECT_WITH_DP = `
  SELECT fd.*,
         dp.id AS direct_part_id, dp.part_id AS dp_part_id, dp.name AS dp_name,
         dp.image_url AS dp_image_url, dp.price AS dp_price, dp.currency AS dp_currency,
         dp.supplier AS dp_supplier, dp.in_stock AS dp_in_stock
  FROM flow_decisions_v2 fd
  LEFT JOIN direct_parts dp ON fd.id = dp.flow_decision_id`

export interface ListOptions {
  page?: number
  pageSize?: number
  search?: string
  status?: FlowDecisionStatus
  orderBy?: 'createdAt' | 'updatedAt' | 'partDescription'
  orderDirection?: 'asc' | 'desc'
}

export async function getAllFlowDecisions(opts: ListOptions = {}): Promise<{
  items: FlowDecisionRecord[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}> {
  const page = Math.max(1, opts.page || 1)
  const pageSize = Math.min(2000, Math.max(1, opts.pageSize || 50))
  const offset = (page - 1) * pageSize

  const conds: string[] = []
  const params: any[] = []
  if (opts.status) {
    params.push(opts.status)
    conds.push(`fd.status = $${params.length}`)
  }
  if (opts.search) {
    params.push(`%${opts.search}%`)
    const i = params.length
    conds.push(`(fd.part_description ILIKE $${i} OR fd.category ILIKE $${i} OR fd.subcategory ILIKE $${i} OR fd.schema ILIKE $${i})`)
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''
  const orderCol = { createdAt: 'created_at', updatedAt: 'updated_at', partDescription: 'part_description' }[
    opts.orderBy || 'createdAt'
  ]
  const dir = (opts.orderDirection || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC'

  const [items, count] = await Promise.all([
    query(`${SELECT_WITH_DP} ${where} ORDER BY fd.${orderCol} ${dir} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [
      ...params,
      pageSize,
      offset,
    ]),
    query(`SELECT COUNT(*)::int AS total FROM flow_decisions_v2 fd ${where}`, params),
  ])
  const total = count.rows[0]?.total ?? 0
  return { items: items.rows.map(rowToRecord), total, page, pageSize, totalPages: Math.ceil(total / pageSize) || 1 }
}

export async function getFlowDecisionById(id: string): Promise<FlowDecisionRecord | null> {
  const res = await query(`${SELECT_WITH_DP} WHERE fd.id = $1`, [id])
  return res.rows[0] ? rowToRecord(res.rows[0]) : null
}

export interface CreateInput {
  partDescription: string
  category: string
  subcategory: string
  schema: string
  lambdaTarget?: string
  status?: FlowDecisionStatus
  vehicleFilters?: any
  metadata?: any
  createdBy?: string | null
}

export async function createFlowDecision(input: CreateInput): Promise<FlowDecisionRecord> {
  const normalized = normalizeDescription(input.partDescription)
  const lambdaTarget = input.lambdaTarget || 'partslink'
  const status: FlowDecisionStatus = input.status || 'suggestion'
  const yf = input.vehicleFilters?.yearFrom || null
  const yt = input.vehicleFilters?.yearTo || null
  const model = normalizeFilter(input.vehicleFilters?.model || input.vehicleFilters?.modelName)
  const fuel = normalizeFilter(input.vehicleFilters?.fuelType)
  const engine = normalizeFilter(input.vehicleFilters?.engineModel)
  const vin = normalizeFilter(input.vehicleFilters?.vinPattern)

  // 1. Ensure the part_descriptions row exists (FK target), with an embedding when available.
  const existingPd = await query('SELECT description FROM part_descriptions WHERE description = $1', [normalized])
  if (!existingPd.rows[0]) {
    const vec = await embedText(normalized)
    if (vec) {
      await query(
        `INSERT INTO part_descriptions (description, embedding, original_description, usage_count, last_accessed, updated_at)
         VALUES ($1, $2::vector, $3, 1, NOW(), NOW())
         ON CONFLICT (description) DO UPDATE SET usage_count = part_descriptions.usage_count + 1, last_accessed = NOW()`,
        [normalized, toVectorLiteral(vec), input.partDescription],
      )
    } else {
      await query(
        `INSERT INTO part_descriptions (description, original_description, usage_count, last_accessed, updated_at)
         VALUES ($1, $2, 1, NOW(), NOW())
         ON CONFLICT (description) DO NOTHING`,
        [normalized, input.partDescription],
      )
    }
  }

  // 2. Duplicate check on the 8-col unique key.
  const dup = await query(
    `SELECT * FROM flow_decisions_v2
     WHERE part_description = $1 AND lambda_target = $2
       AND vehicle_year_from IS NOT DISTINCT FROM $3 AND vehicle_year_to IS NOT DISTINCT FROM $4
       AND vehicle_model IS NOT DISTINCT FROM $5 AND vehicle_fuel_type IS NOT DISTINCT FROM $6
       AND vehicle_engine_model IS NOT DISTINCT FROM $7 AND vin_pattern IS NOT DISTINCT FROM $8`,
    [normalized, lambdaTarget, yf, yt, model, fuel, engine, vin],
  )
  if (dup.rows[0]) {
    const ex = dup.rows[0]
    if (ex.status === 'rejected') {
      const upd = await query(
        `UPDATE flow_decisions_v2
         SET category = $2, subcategory = $3, schema = $4, status = $5, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [ex.id, input.category, input.subcategory, input.schema, status],
      )
      return (await getFlowDecisionById(upd.rows[0].id))!
    }
    return (await getFlowDecisionById(ex.id))!
  }

  // 3. Insert the new rule.
  const ins = await query(
    `INSERT INTO flow_decisions_v2
       (part_description, category, subcategory, schema, lambda_target, status, created_by,
        is_default, vehicle_year_from, vehicle_year_to, vehicle_model, vehicle_fuel_type,
        vehicle_engine_model, vin_pattern, metadata, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,false,$8,$9,$10,$11,$12,$13,$14,NOW())
     RETURNING id`,
    [
      normalized, input.category, input.subcategory, input.schema, lambdaTarget, status,
      input.createdBy ?? null, yf, yt, model, fuel, engine, vin,
      input.metadata != null ? JSON.stringify(input.metadata) : null,
    ],
  )
  return (await getFlowDecisionById(ins.rows[0].id))!
}

export interface UpdateInput {
  partDescription?: string
  category?: string
  subcategory?: string
  schema?: string
  lambdaTarget?: string
  status?: FlowDecisionStatus
  isDefault?: boolean
  metadata?: any
  vehicleFilters?: any
}

export async function updateFlowDecision(id: string, data: UpdateInput): Promise<FlowDecisionRecord | null> {
  const sets: string[] = []
  const params: any[] = []
  const set = (col: string, val: any) => {
    params.push(val)
    sets.push(`${col} = $${params.length}`)
  }
  let pathChanged = false
  if (data.partDescription !== undefined) { set('part_description', normalizeDescription(data.partDescription)); pathChanged = true }
  if (data.category !== undefined) { set('category', data.category); pathChanged = true }
  if (data.subcategory !== undefined) { set('subcategory', data.subcategory); pathChanged = true }
  if (data.schema !== undefined) { set('schema', data.schema); pathChanged = true }
  if (data.lambdaTarget !== undefined) set('lambda_target', data.lambdaTarget)
  if (data.status !== undefined) set('status', data.status)
  if (data.isDefault !== undefined) set('is_default', data.isDefault)
  if (data.metadata !== undefined) set('metadata', data.metadata != null ? JSON.stringify(data.metadata) : null)
  if (data.vehicleFilters !== undefined) {
    set('vehicle_year_from', data.vehicleFilters.yearFrom || null)
    set('vehicle_year_to', data.vehicleFilters.yearTo || null)
    set('vehicle_model', normalizeFilter(data.vehicleFilters.model || data.vehicleFilters.modelName))
    set('vehicle_fuel_type', normalizeFilter(data.vehicleFilters.fuelType))
    set('vehicle_engine_model', normalizeFilter(data.vehicleFilters.engineModel))
    set('vin_pattern', normalizeFilter(data.vehicleFilters.vinPattern))
  }
  if (sets.length === 0) return getFlowDecisionById(id)
  sets.push('updated_at = NOW()')
  params.push(id)
  const res = await query(`UPDATE flow_decisions_v2 SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING part_description`, params)
  if (!res.rows[0]) return null

  // Regenerate the part_descriptions embedding when the description/path changed (best-effort).
  if (pathChanged) {
    const desc = res.rows[0].part_description
    const vec = await embedText(desc)
    if (vec) {
      await query(
        `INSERT INTO part_descriptions (description, embedding, original_description, usage_count, last_accessed, updated_at)
         VALUES ($1, $2::vector, $1, 1, NOW(), NOW())
         ON CONFLICT (description) DO UPDATE SET embedding = EXCLUDED.embedding, last_accessed = NOW(), updated_at = NOW()`,
        [desc, toVectorLiteral(vec)],
      )
    }
  }
  return getFlowDecisionById(id)
}

export async function updateStatus(
  id: string,
  status: FlowDecisionStatus,
  reviewedBy = 'admin',
): Promise<FlowDecisionRecord | null> {
  // Stamp the audit columns so approvals/rejections are attributable, matching
  // the dedicated /suggestions/approve path.
  let extra = ''
  const params: any[] = [id, status]
  if (status === 'approved') {
    params.push(reviewedBy)
    extra = `, approved_at = NOW(), approved_by = $3, rejected_at = NULL, rejected_by = NULL`
  } else if (status === 'rejected') {
    params.push(reviewedBy)
    extra = `, rejected_at = NOW(), rejected_by = $3`
  }
  const res = await query(
    `UPDATE flow_decisions_v2 SET status = $2, updated_at = NOW()${extra} WHERE id = $1 RETURNING id`,
    params,
  )
  return res.rows[0] ? getFlowDecisionById(id) : null
}

export async function deleteFlowDecision(id: string): Promise<boolean> {
  const res = await query('DELETE FROM flow_decisions_v2 WHERE id = $1', [id])
  return (res.rowCount ?? 0) > 0
}

export async function setDefaultFlowDecision(id: string): Promise<boolean> {
  const pool = await getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const cur = await client.query('SELECT part_description FROM flow_decisions_v2 WHERE id = $1 FOR UPDATE', [id])
    if (!cur.rows[0]) {
      await client.query('ROLLBACK')
      return false
    }
    await client.query(
      `UPDATE flow_decisions_v2 SET is_default = false WHERE part_description = $1 AND id <> $2`,
      [cur.rows[0].part_description, id],
    )
    await client.query(`UPDATE flow_decisions_v2 SET is_default = true, updated_at = NOW() WHERE id = $1`, [id])
    await client.query('COMMIT')
    return true
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/* ── Coverage / retro-scan ───────────────────────────────────────────── */

export async function getCoverage(): Promise<{ descriptions: any[]; total: number; uncovered: number }> {
  const res = await query(
    `SELECT pd.description, pd.usage_count,
            EXISTS (SELECT 1 FROM flow_decisions_v2 fd WHERE fd.part_description = pd.description AND fd.status = 'approved') AS has_rule
     FROM part_descriptions pd
     ORDER BY pd.usage_count DESC NULLS LAST
     LIMIT 1000`,
  )
  const rows = res.rows.map((d: any) => ({
    description: d.description,
    usageCount: d.usage_count,
    hasRule: d.has_rule,
  }))
  return { descriptions: rows, total: rows.length, uncovered: rows.filter((r) => !r.hasRule).length }
}

export async function retroScan(daysBack = 30, limit = 50): Promise<{
  suggestions: any[]
  scannedSince: string
  considered: number
  proposed: number
}> {
  const since = new Date(Date.now() - daysBack * 86400000)
  const res = await query(
    `SELECT pd.description, pd.usage_count
     FROM part_descriptions pd
     WHERE pd.last_accessed >= $1
       AND NOT EXISTS (
         SELECT 1 FROM flow_decisions_v2 fd
         WHERE fd.part_description = pd.description AND fd.status IN ('approved','suggestion'))
     ORDER BY pd.usage_count DESC NULLS LAST
     LIMIT $2`,
    [since.toISOString(), limit],
  )
  const suggestions = res.rows.map((c: any) => ({
    partDescription: c.description,
    category: 'TBD',
    subcategory: 'TBD',
    schema: 'TBD',
    lambdaTarget: 'partslink',
    occurrences: c.usage_count,
  }))
  return { suggestions, scannedSince: since.toISOString(), considered: res.rows.length, proposed: suggestions.length }
}

/* ── Autocomplete ────────────────────────────────────────────────────── */

interface BilingualSuggestion {
  en: string
  he?: string
}

async function getHebrewTranslations(englishTerms: string[]): Promise<Map<string, string>> {
  if (englishTerms.length === 0) return new Map()
  try {
    const res = await query(
      `SELECT source_word, target_word FROM word_mappings
       WHERE target_language = 'en' AND source_language = 'he' AND mapping_type = 'translation' AND is_active = true`,
    )
    const exactMap = new Map<string, string>()
    for (const m of res.rows as any[]) exactMap.set(m.target_word.toLowerCase(), m.source_word)
    const hebrewMap = new Map<string, string>()
    for (const term of englishTerms) {
      const termLower = term.toLowerCase()
      if (exactMap.has(termLower)) {
        hebrewMap.set(termLower, exactMap.get(termLower)!)
        continue
      }
      const mainParts = termLower.split(/\s*[-/]\s*/).filter((p) => p.length > 2)
      const hebrewParts: string[] = []
      for (const mainPart of mainParts) {
        if (exactMap.has(mainPart)) {
          hebrewParts.push(exactMap.get(mainPart)!)
          continue
        }
        const sorted = Array.from(exactMap.entries()).filter(([e]) => e.length > 2).sort((a, b) => b[0].length - a[0].length)
        let remaining = mainPart
        const found: string[] = []
        for (const [eng, heb] of sorted) {
          if (remaining.includes(eng)) {
            found.push(heb)
            remaining = remaining.replace(eng, ' ')
            if (found.length >= 2) break
          }
        }
        hebrewParts.push(...found)
      }
      if (hebrewParts.length > 0) hebrewMap.set(termLower, [...new Set(hebrewParts)].slice(0, 3).join(' - '))
    }
    return hebrewMap
  } catch {
    return new Map()
  }
}

export async function getAutocomplete(lambdaId = 'all'): Promise<{
  categories: BilingualSuggestion[]
  subcategories: BilingualSuggestion[]
  schemas: BilingualSuggestion[]
  partDescriptions: BilingualSuggestion[]
}> {
  const params: any[] = []
  let lambdaCond = ''
  if (lambdaId !== 'all') {
    params.push(lambdaId)
    lambdaCond = ` AND lambda_target = $1`
  }
  const distinct = async (col: string) => {
    const res = await query(
      `SELECT DISTINCT ${col} AS v FROM flow_decisions_v2 WHERE status <> 'rejected'${lambdaCond} AND ${col} IS NOT NULL ORDER BY ${col} ASC`,
      params,
    )
    return res.rows.map((r: any) => r.v).filter(Boolean) as string[]
  }
  const [categories, subcategories, schemas, partDescriptions] = await Promise.all([
    distinct('category'),
    distinct('subcategory'),
    distinct('schema'),
    distinct('part_description'),
  ])
  const allTerms = [...new Set([...categories, ...subcategories, ...schemas, ...partDescriptions])]
  const hebrewMap = await getHebrewTranslations(allTerms)
  const toBi = (terms: string[]): BilingualSuggestion[] => terms.map((t) => ({ en: t, he: hebrewMap.get(t.toLowerCase()) }))
  return {
    categories: toBi(categories),
    subcategories: toBi(subcategories),
    schemas: toBi(schemas),
    partDescriptions: toBi(partDescriptions),
  }
}

/* ── Simulator (focused: word-mapping expansion + cosine search + vehicle scoring) ── */

export interface SimulateVehicle {
  year?: number
  model?: string
  fuelType?: string
  engineModel?: string
}

function scoreVehicleMatch(row: any, v: SimulateVehicle): { score: number; filterCount: number; reasons: string[] } {
  const reasons: string[] = []
  let filterCount = 0
  let matched = 0
  const check = (rowVal: any, qVal: any, label: string, range?: [any, any]) => {
    if (rowVal == null && (range == null || (range[0] == null && range[1] == null))) return
    filterCount++
    if (range) {
      const [from, to] = range
      const y = qVal
      if (y == null) { reasons.push(`${label} unspecified`); return }
      if ((from == null || y >= from) && (to == null || y <= to)) matched++
      else reasons.push(`${label} ${y} ∉ ${from ?? '*'}–${to ?? '*'}`)
      return
    }
    if (qVal == null) { reasons.push(`${label} unspecified`); return }
    if (String(rowVal).toLowerCase() === String(qVal).toLowerCase()) matched++
    else reasons.push(`${label} ${qVal} ≠ ${rowVal}`)
  }
  if (row.vehicle_year_from != null || row.vehicle_year_to != null) check(null, v.year, 'year', [row.vehicle_year_from, row.vehicle_year_to])
  if (row.vehicle_model) check(row.vehicle_model, v.model, 'model')
  if (row.vehicle_fuel_type) check(row.vehicle_fuel_type, v.fuelType, 'fuel')
  if (row.vehicle_engine_model) check(row.vehicle_engine_model, v.engineModel, 'engine')
  const score = filterCount === 0 ? 1 : matched / filterCount
  return { score, filterCount, reasons }
}

export async function simulate(
  partDescription: string,
  vehicle: SimulateVehicle = {},
  threshold = 0.6,
): Promise<{ ok: boolean; reason?: string; bestMatch: any; allCandidates: any[]; matchType: string }> {
  // Expand the query term via word mappings (he → en canonical / en synonyms).
  const hasHebrew = /[֐-׿]/.test(partDescription)
  const lang = hasHebrew ? 'he' : 'en'
  const terms = new Set<string>([partDescription.toLowerCase().trim()])
  try {
    const exp = await query(
      `SELECT target_word FROM word_mappings
       WHERE LOWER(source_word) = LOWER($1) AND source_language = $2 AND is_active = true
       ORDER BY is_default DESC, usage_count DESC LIMIT 5`,
      [partDescription.trim(), lang],
    )
    for (const r of exp.rows as any[]) terms.add(String(r.target_word).toLowerCase())
  } catch {
    /* expansion is best-effort */
  }

  // Embed each candidate term and cosine-search the view; keep the best similarity per rule.
  const byId = new Map<string, { row: any; sim: number }>()
  let embeddedAny = false
  for (const term of terms) {
    const vec = await embedText(term)
    if (!vec) continue
    embeddedAny = true
    const res = await query(
      `SELECT *, 1 - (part_description_embedding <=> $1::vector) AS similarity
       FROM flow_decisions_with_embeddings
       WHERE status = 'approved' AND part_description_embedding IS NOT NULL
       ORDER BY part_description_embedding <=> $1::vector
       LIMIT 20`,
      [toVectorLiteral(vec)],
    )
    for (const row of res.rows as any[]) {
      const sim = Number(row.similarity)
      const prev = byId.get(row.id)
      if (!prev || sim > prev.sim) byId.set(row.id, { row, sim })
    }
  }

  if (!embeddedAny) {
    return {
      ok: false,
      reason: 'Embeddings unavailable (OPENAI_API_KEY not configured) — simulator requires vector search.',
      bestMatch: null,
      allCandidates: [],
      matchType: 'unavailable',
    }
  }

  const candidates = Array.from(byId.values())
    .filter((c) => c.sim >= threshold)
    .map(({ row, sim }) => {
      const vs = scoreVehicleMatch(row, vehicle)
      return { row, sim, ...vs, matchScore: Math.round(sim * vs.score * 1000) / 1000 }
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 12)

  const best = candidates[0]
  return {
    ok: true,
    matchType: best ? 'semantic' : 'no_match',
    bestMatch: best
      ? {
          id: best.row.id,
          category: best.row.category,
          subcategory: best.row.subcategory,
          schema: best.row.schema,
          confidence: best.matchScore,
          reasoning: `cosine ${best.sim.toFixed(3)}, vehicle ${(best.score * 100).toFixed(0)}%`,
          filters: {
            yearFrom: best.row.vehicle_year_from,
            yearTo: best.row.vehicle_year_to,
            model: best.row.vehicle_model,
            fuelType: best.row.vehicle_fuel_type,
            engineModel: best.row.vehicle_engine_model,
            vinPattern: best.row.vin_pattern,
          },
        }
      : null,
    allCandidates: candidates.map((c) => ({
      id: c.row.id,
      category: c.row.category,
      subcategory: c.row.subcategory,
      schema: c.row.schema,
      matchScore: c.matchScore,
      filterCount: c.filterCount,
      mismatchReasons: c.reasons,
      vehicleYearFrom: c.row.vehicle_year_from,
      vehicleYearTo: c.row.vehicle_year_to,
      vehicleModel: c.row.vehicle_model,
      vehicleFuelType: c.row.vehicle_fuel_type,
      vehicleEngineModel: c.row.vehicle_engine_model,
      vinPattern: c.row.vin_pattern,
    })),
  }
}
