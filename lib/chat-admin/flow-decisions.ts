/**
 * Flow-decisions data access for the integrated chat admin.
 * Drizzle ORM over the shared `flow_decisions_v2` / `part_descriptions` /
 * `direct_parts` tables. Raw SQL is kept only where an ORM can't express it:
 * the pgvector embedding upsert and the simulate cosine search against the
 * `flow_decisions_with_embeddings` view.
 */

import { and, asc, desc, eq, gte, ilike, or, sql, count } from 'drizzle-orm'
import { getDb, query } from '@/lib/db'
import { flowDecisionsV2, partDescriptions, directParts, wordMappings } from '@/lib/db/schema'
import { embedText, toVectorLiteral } from '@/lib/chat-admin/embeddings'
import type { FlowDecisionRecord, FlowDecisionStatus } from '@/types/chat-admin/flow-decision'

/* eslint-disable @typescript-eslint/no-explicit-any */

type FdRow = typeof flowDecisionsV2.$inferSelect
type DpRow = typeof directParts.$inferSelect

const normalizeDescription = (d: string) => (d || '').toLowerCase().trim()
const normalizeFilter = (v: any): string | null => {
  if (!v) return null
  const t = String(v).trim()
  if (!t || t.toLowerCase() === 'unknown') return null
  return t
}

export function rowToRecord(fd: FdRow, dp?: DpRow | null): FlowDecisionRecord {
  const directPart = dp
    ? {
        id: dp.id,
        partId: dp.partId,
        name: dp.name,
        imageUrl: dp.imageUrl,
        price: dp.price != null ? Number(dp.price) : undefined,
        currency: dp.currency || 'ILS',
        supplier: dp.supplier,
        inStock: dp.inStock ?? true,
      }
    : undefined
  return {
    id: fd.id,
    partDescription: fd.partDescription,
    flowDecision: { category: fd.category, subcategory: fd.subcategory, schema: fd.schema },
    category: fd.category,
    subcategory: fd.subcategory,
    schema: fd.schema,
    feedbackCount: fd.feedbackCount || 0,
    createdAt: fd.createdAt,
    updatedAt: fd.updatedAt,
    isDefault: fd.isDefault || false,
    createdBy: fd.createdBy,
    lambdaTarget: fd.lambdaTarget,
    status: fd.status,
    metadata: fd.metadata as any,
    source: fd.source,
    confidence: fd.confidence != null ? Number(fd.confidence) : null,
    approvedAt: fd.approvedAt,
    approvedBy: fd.approvedBy,
    rejectedAt: fd.rejectedAt,
    rejectedBy: fd.rejectedBy,
    rejectionReason: fd.rejectionReason,
    vehicleYearFrom: fd.vehicleYearFrom,
    vehicleYearTo: fd.vehicleYearTo,
    vehicleModel: fd.vehicleModel,
    vehicleFuelType: fd.vehicleFuelType,
    vehicleEngineModel: fd.vehicleEngineModel,
    vinPattern: fd.vinPattern,
    vehicleFilters: {
      year: fd.vehicleYearFrom || fd.vehicleYearTo ? `${fd.vehicleYearFrom || ''}-${fd.vehicleYearTo || ''}` : undefined,
      yearFrom: fd.vehicleYearFrom,
      yearTo: fd.vehicleYearTo,
      model: fd.vehicleModel,
      fuelType: fd.vehicleFuelType,
      engineModel: fd.vehicleEngineModel,
      vinPattern: fd.vinPattern,
    },
    directPart,
  }
}

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
  const db = await getDb()
  const page = Math.max(1, opts.page || 1)
  const pageSize = Math.min(2000, Math.max(1, opts.pageSize || 50))
  const offset = (page - 1) * pageSize

  const conds = []
  if (opts.status) conds.push(eq(flowDecisionsV2.status, opts.status))
  if (opts.search) {
    const p = `%${opts.search}%`
    conds.push(
      or(
        ilike(flowDecisionsV2.partDescription, p),
        ilike(flowDecisionsV2.category, p),
        ilike(flowDecisionsV2.subcategory, p),
        ilike(flowDecisionsV2.schema, p),
      ),
    )
  }
  const where = conds.length ? and(...conds) : undefined

  const colMap = {
    createdAt: flowDecisionsV2.createdAt,
    updatedAt: flowDecisionsV2.updatedAt,
    partDescription: flowDecisionsV2.partDescription,
  } as const
  const dir = (opts.orderDirection || 'desc') === 'asc' ? asc : desc
  const orderCol = colMap[opts.orderBy || 'createdAt']

  const [rows, totalRes] = await Promise.all([
    db
      .select({ fd: flowDecisionsV2, dp: directParts })
      .from(flowDecisionsV2)
      .leftJoin(directParts, eq(directParts.flowDecisionId, flowDecisionsV2.id))
      .where(where)
      .orderBy(dir(orderCol))
      .limit(pageSize)
      .offset(offset),
    db.select({ value: count() }).from(flowDecisionsV2).where(where),
  ])
  const total = totalRes[0]?.value ?? 0
  return {
    items: rows.map((r) => rowToRecord(r.fd, r.dp)),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize) || 1,
  }
}

export async function getFlowDecisionById(id: string): Promise<FlowDecisionRecord | null> {
  const db = await getDb()
  const [row] = await db
    .select({ fd: flowDecisionsV2, dp: directParts })
    .from(flowDecisionsV2)
    .leftJoin(directParts, eq(directParts.flowDecisionId, flowDecisionsV2.id))
    .where(eq(flowDecisionsV2.id, id))
    .limit(1)
  return row ? rowToRecord(row.fd, row.dp) : null
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
  directPart?: DirectPartInput | null
}

/** Ensure the part_descriptions FK row exists, with an embedding when available (raw SQL — pgvector). */
async function ensurePartDescription(normalized: string, original: string): Promise<void> {
  const db = await getDb()
  const [existing] = await db
    .select({ description: partDescriptions.description })
    .from(partDescriptions)
    .where(eq(partDescriptions.description, normalized))
    .limit(1)
  if (existing) return

  const vec = await embedText(normalized)
  if (vec) {
    await query(
      `INSERT INTO part_descriptions (description, embedding, original_description, usage_count, last_accessed, updated_at)
       VALUES ($1, $2::vector, $3, 1, NOW(), NOW())
       ON CONFLICT (description) DO UPDATE SET usage_count = part_descriptions.usage_count + 1, last_accessed = NOW()`,
      [normalized, toVectorLiteral(vec), original],
    )
  } else {
    await db
      .insert(partDescriptions)
      .values({ description: normalized, originalDescription: original, usageCount: 1, updatedAt: new Date() })
      .onConflictDoNothing({ target: partDescriptions.description })
  }
}

export async function createFlowDecision(input: CreateInput): Promise<FlowDecisionRecord> {
  const db = await getDb()
  const normalized = normalizeDescription(input.partDescription)
  const lambdaTarget = input.lambdaTarget || 'partslink'
  const status: FlowDecisionStatus = input.status || 'suggestion'
  const yf = input.vehicleFilters?.yearFrom || null
  const yt = input.vehicleFilters?.yearTo || null
  const model = normalizeFilter(input.vehicleFilters?.model || input.vehicleFilters?.modelName)
  const fuel = normalizeFilter(input.vehicleFilters?.fuelType)
  const engine = normalizeFilter(input.vehicleFilters?.engineModel)
  const vin = normalizeFilter(input.vehicleFilters?.vinPattern)

  await ensurePartDescription(normalized, input.partDescription)

  // Duplicate check on the 8-col unique key (IS NOT DISTINCT FROM for nullable filters).
  const [dup] = await db
    .select()
    .from(flowDecisionsV2)
    .where(
      and(
        eq(flowDecisionsV2.partDescription, normalized),
        eq(flowDecisionsV2.lambdaTarget, lambdaTarget),
        sql`${flowDecisionsV2.vehicleYearFrom} IS NOT DISTINCT FROM ${yf}`,
        sql`${flowDecisionsV2.vehicleYearTo} IS NOT DISTINCT FROM ${yt}`,
        sql`${flowDecisionsV2.vehicleModel} IS NOT DISTINCT FROM ${model}`,
        sql`${flowDecisionsV2.vehicleFuelType} IS NOT DISTINCT FROM ${fuel}`,
        sql`${flowDecisionsV2.vehicleEngineModel} IS NOT DISTINCT FROM ${engine}`,
        sql`${flowDecisionsV2.vinPattern} IS NOT DISTINCT FROM ${vin}`,
      ),
    )
    .limit(1)
  if (dup) {
    if (dup.status === 'rejected') {
      await db
        .update(flowDecisionsV2)
        .set({
          category: input.category,
          subcategory: input.subcategory,
          schema: input.schema,
          status,
          updatedAt: new Date(),
        })
        .where(eq(flowDecisionsV2.id, dup.id))
    }
    if (input.directPart !== undefined) await setDirectPart(dup.id, input.directPart)
    return (await getFlowDecisionById(dup.id))!
  }

  const [ins] = await db
    .insert(flowDecisionsV2)
    .values({
      partDescription: normalized,
      category: input.category,
      subcategory: input.subcategory,
      schema: input.schema,
      lambdaTarget,
      status,
      createdBy: input.createdBy ?? null,
      isDefault: false,
      vehicleYearFrom: yf,
      vehicleYearTo: yt,
      vehicleModel: model,
      vehicleFuelType: fuel,
      vehicleEngineModel: engine,
      vinPattern: vin,
      metadata: input.metadata ?? null,
      updatedAt: new Date(),
    })
    .returning({ id: flowDecisionsV2.id })
  if (input.directPart !== undefined) await setDirectPart(ins.id, input.directPart)
  return (await getFlowDecisionById(ins.id))!
}

export interface DirectPartInput {
  partId: string
  name?: string
  imageUrl?: string | null
  price?: number | null
  currency?: string
  supplier?: string | null
  inStock?: boolean
}

/**
 * Upsert (or clear) the pinned `direct_part` for a flow decision. Pass null — or an empty
 * partId — to remove the pin. When no name is given it falls back to the decision's schema.
 * This is what the live matcher returns as the "direct part", so editing it here changes
 * what Diego answers for that description+scope.
 */
export async function setDirectPart(flowDecisionId: string, input: DirectPartInput | null): Promise<void> {
  const db = await getDb()
  const partId = input?.partId?.trim()
  if (!partId) {
    await db.delete(directParts).where(eq(directParts.flowDecisionId, flowDecisionId))
    return
  }
  // name = the part's catalog name (how it's listed inside the schema, e.g. 'OIL SEPARATOR
  // SEAL') — that's how the lambda finds the direct part within the schema. Staff enter it in
  // the editor; if left blank we fall back to the schema, then the part id.
  let name = (input?.name || '').trim()
  if (!name) {
    const [fd] = await db
      .select({ schema: flowDecisionsV2.schema })
      .from(flowDecisionsV2)
      .where(eq(flowDecisionsV2.id, flowDecisionId))
      .limit(1)
    name = fd?.schema || partId
  }
  const values = {
    partId,
    name,
    imageUrl: input?.imageUrl ?? null,
    price: input?.price != null ? String(input.price) : null,
    currency: input?.currency || 'ILS',
    supplier: input?.supplier ?? null,
    inStock: input?.inStock ?? true,
    updatedAt: new Date(),
  }
  const [existing] = await db
    .select({ id: directParts.id })
    .from(directParts)
    .where(eq(directParts.flowDecisionId, flowDecisionId))
    .limit(1)
  if (existing) {
    await db.update(directParts).set(values).where(eq(directParts.id, existing.id))
  } else {
    await db.insert(directParts).values({ flowDecisionId, ...values })
  }
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
  directPart?: DirectPartInput | null
}

export async function updateFlowDecision(id: string, data: UpdateInput): Promise<FlowDecisionRecord | null> {
  const db = await getDb()
  const set: Partial<typeof flowDecisionsV2.$inferInsert> = { updatedAt: new Date() }
  let pathChanged = false
  if (data.partDescription !== undefined) {
    set.partDescription = normalizeDescription(data.partDescription)
    pathChanged = true
  }
  if (data.category !== undefined) { set.category = data.category; pathChanged = true }
  if (data.subcategory !== undefined) { set.subcategory = data.subcategory; pathChanged = true }
  if (data.schema !== undefined) { set.schema = data.schema; pathChanged = true }
  if (data.lambdaTarget !== undefined) set.lambdaTarget = data.lambdaTarget
  if (data.status !== undefined) set.status = data.status
  if (data.isDefault !== undefined) set.isDefault = data.isDefault
  if (data.metadata !== undefined) set.metadata = data.metadata ?? null
  if (data.vehicleFilters !== undefined) {
    set.vehicleYearFrom = data.vehicleFilters.yearFrom || null
    set.vehicleYearTo = data.vehicleFilters.yearTo || null
    set.vehicleModel = normalizeFilter(data.vehicleFilters.model || data.vehicleFilters.modelName)
    set.vehicleFuelType = normalizeFilter(data.vehicleFilters.fuelType)
    set.vehicleEngineModel = normalizeFilter(data.vehicleFilters.engineModel)
    set.vinPattern = normalizeFilter(data.vehicleFilters.vinPattern)
  }

  const [row] = await db
    .update(flowDecisionsV2)
    .set(set)
    .where(eq(flowDecisionsV2.id, id))
    .returning({ partDescription: flowDecisionsV2.partDescription })
  if (!row) return null

  // Regenerate the part_descriptions embedding when the description/path changed (raw — pgvector).
  if (pathChanged) {
    const desc = row.partDescription
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
  if (data.directPart !== undefined) await setDirectPart(id, data.directPart)
  return getFlowDecisionById(id)
}

export async function updateStatus(
  id: string,
  status: FlowDecisionStatus,
  reviewedBy = 'admin',
): Promise<FlowDecisionRecord | null> {
  const db = await getDb()
  const set: Partial<typeof flowDecisionsV2.$inferInsert> = { status, updatedAt: new Date() }
  if (status === 'approved') {
    set.approvedAt = new Date()
    set.approvedBy = reviewedBy
    set.rejectedAt = null
    set.rejectedBy = null
  } else if (status === 'rejected') {
    set.rejectedAt = new Date()
    set.rejectedBy = reviewedBy
  }
  const [row] = await db.update(flowDecisionsV2).set(set).where(eq(flowDecisionsV2.id, id)).returning({ id: flowDecisionsV2.id })
  return row ? getFlowDecisionById(id) : null
}

export async function deleteFlowDecision(id: string): Promise<boolean> {
  const db = await getDb()
  const deleted = await db.delete(flowDecisionsV2).where(eq(flowDecisionsV2.id, id)).returning({ id: flowDecisionsV2.id })
  return deleted.length > 0
}

export async function setDefaultFlowDecision(id: string): Promise<boolean> {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [cur] = await tx
      .select({ partDescription: flowDecisionsV2.partDescription })
      .from(flowDecisionsV2)
      .where(eq(flowDecisionsV2.id, id))
      .for('update')
      .limit(1)
    if (!cur) return false
    await tx
      .update(flowDecisionsV2)
      .set({ isDefault: false })
      .where(and(eq(flowDecisionsV2.partDescription, cur.partDescription), sql`${flowDecisionsV2.id} <> ${id}`))
    await tx.update(flowDecisionsV2).set({ isDefault: true, updatedAt: new Date() }).where(eq(flowDecisionsV2.id, id))
    return true
  })
}

/* ── Coverage / retro-scan ───────────────────────────────────────────── */

export async function getCoverage(): Promise<{ descriptions: any[]; total: number; uncovered: number }> {
  const db = await getDb()
  const rows = await db
    .select({
      description: partDescriptions.description,
      usageCount: partDescriptions.usageCount,
      hasRule: sql<boolean>`EXISTS (SELECT 1 FROM flow_decisions_v2 fd WHERE fd.part_description = ${partDescriptions.description} AND fd.status = 'approved')`,
    })
    .from(partDescriptions)
    .orderBy(desc(partDescriptions.usageCount))
    .limit(1000)
  return { descriptions: rows, total: rows.length, uncovered: rows.filter((r) => !r.hasRule).length }
}

export async function retroScan(daysBack = 30, limit = 50): Promise<{
  suggestions: any[]
  scannedSince: string
  considered: number
  proposed: number
}> {
  const db = await getDb()
  const since = new Date(Date.now() - daysBack * 86400000)
  const rows = await db
    .select({ description: partDescriptions.description, usageCount: partDescriptions.usageCount })
    .from(partDescriptions)
    .where(
      and(
        gte(partDescriptions.lastAccessed, since),
        sql`NOT EXISTS (SELECT 1 FROM flow_decisions_v2 fd WHERE fd.part_description = ${partDescriptions.description} AND fd.status IN ('approved','suggestion'))`,
      ),
    )
    .orderBy(desc(partDescriptions.usageCount))
    .limit(limit)
  const suggestions = rows.map((c) => ({
    partDescription: c.description,
    category: 'TBD',
    subcategory: 'TBD',
    schema: 'TBD',
    lambdaTarget: 'partslink',
    occurrences: c.usageCount,
  }))
  return { suggestions, scannedSince: since.toISOString(), considered: rows.length, proposed: suggestions.length }
}

/* ── Autocomplete ────────────────────────────────────────────────────── */

interface BilingualSuggestion {
  en: string
  he?: string
}

async function getHebrewTranslations(englishTerms: string[]): Promise<Map<string, string>> {
  if (englishTerms.length === 0) return new Map()
  try {    const db = await getDb()
    const rows = await db
      .select({ sourceWord: wordMappings.sourceWord, targetWord: wordMappings.targetWord })
      .from(wordMappings)
      .where(
        and(
          eq(wordMappings.targetLanguage, 'en'),
          eq(wordMappings.sourceLanguage, 'he'),
          eq(wordMappings.mappingType, 'translation'),
          eq(wordMappings.isActive, true),
        ),
      )
    const exactMap = new Map<string, string>()
    for (const m of rows) exactMap.set(m.targetWord.toLowerCase(), m.sourceWord)
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
  const db = await getDb()
  const base = lambdaId === 'all'
    ? sql`status <> 'rejected'`
    : and(sql`status <> 'rejected'`, eq(flowDecisionsV2.lambdaTarget, lambdaId))

  const distinctCol = async (col: any) => {
    const rows = await db
      .selectDistinct({ v: col })
      .from(flowDecisionsV2)
      .where(and(base, sql`${col} IS NOT NULL`))
      .orderBy(asc(col))
    return rows.map((r) => r.v).filter(Boolean) as string[]
  }
  const [categories, subcategories, schemas, parts] = await Promise.all([
    distinctCol(flowDecisionsV2.category),
    distinctCol(flowDecisionsV2.subcategory),
    distinctCol(flowDecisionsV2.schema),
    distinctCol(flowDecisionsV2.partDescription),
  ])
  const allTerms = [...new Set([...categories, ...subcategories, ...schemas, ...parts])]
  const hebrewMap = await getHebrewTranslations(allTerms)
  const toBi = (terms: string[]): BilingualSuggestion[] => terms.map((t) => ({ en: t, he: hebrewMap.get(t.toLowerCase()) }))
  return {
    categories: toBi(categories),
    subcategories: toBi(subcategories),
    schemas: toBi(schemas),
    partDescriptions: toBi(parts),
  }
}

/* ── Simulator (raw: pgvector cosine search against the embeddings view) ── */

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
  const db = await getDb()
  // Expand the query term via word mappings (he → en canonical / en synonyms).
  const hasHebrew = /[֐-׿]/.test(partDescription)
  const lang = hasHebrew ? 'he' : 'en'
  const terms = new Set<string>([partDescription.toLowerCase().trim()])
  try {    const exp = await db
      .select({ targetWord: wordMappings.targetWord })
      .from(wordMappings)
      .where(
        and(
          sql`LOWER(${wordMappings.sourceWord}) = LOWER(${partDescription.trim()})`,
          eq(wordMappings.sourceLanguage, lang),
          eq(wordMappings.isActive, true),
        ),
      )
      .orderBy(desc(wordMappings.isDefault), desc(wordMappings.usageCount))
      .limit(5)
    for (const r of exp) terms.add(String(r.targetWord).toLowerCase())
  } catch {
    /* expansion is best-effort */
  }

  // Embed each candidate term and cosine-search the view; keep best similarity per rule.
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
      const simv = Number(row.similarity)
      const prev = byId.get(row.id)
      if (!prev || simv > prev.sim) byId.set(row.id, { row, sim: simv })
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
