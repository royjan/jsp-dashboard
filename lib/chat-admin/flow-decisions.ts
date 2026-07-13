/**
 * Flow-decisions data access for the integrated chat admin.
 * Drizzle ORM over the shared `flow_decisions_v2` / `part_descriptions` /
 * `direct_parts` tables. Raw SQL is kept only where an ORM can't express it:
 * the pgvector embedding upsert and the simulate cosine search against the
 * `flow_decisions_with_embeddings` view.
 */

import { and, asc, desc, eq, gte, ilike, inArray, or, sql, count } from 'drizzle-orm'
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

// ─────────────────────────────────────────────────────────────────────────────
// Flow Decisions Observatory — a richer, debuggable trace (superset of simulate)
// ─────────────────────────────────────────────────────────────────────────────

export type TraceStatus = 'approved' | 'suggestion' | 'rejected'

/** Discrete PRODUCTION mirror: prefer the rule where the MOST filters ALL match;
 *  otherwise fall back to the generic (isDefault / zero-filter) rule. Returns its id. */
function pickProduction(cands: { row: any; filterCount: number; matched: number }[]): string | null {
  const full = cands
    .filter((c) => c.filterCount > 0 && c.matched === c.filterCount)
    .sort((a, b) => b.filterCount - a.filterCount)
  if (full.length) return full[0].row.id
  const generic = cands.find((c) => c.filterCount === 0 || c.row.is_default)
  return generic?.row.id ?? null
}

/** No-vector fallback: exact/ILIKE match on part_description (works without embeddings). */
async function getRulesByExactTerm(term: string, includeStatuses: TraceStatus[]): Promise<any[]> {
  const statusList = includeStatuses.map((s) => `'${s}'`).join(',')
  const res = await query(
    `SELECT * FROM flow_decisions_v2
     WHERE status IN (${statusList}) AND LOWER(part_description) LIKE $1
     ORDER BY is_default DESC LIMIT 20`,
    [`%${term.toLowerCase()}%`],
  )
  return (res.rows as any[]).map((row) => ({
    id: row.id, category: row.category, subcategory: row.subcategory, schema: row.schema,
    status: row.status, source: row.source, isDefault: row.is_default, lambdaTarget: row.lambda_target,
    cosineSim: null, matchScore: null, vehicleScore: null, filterCount: 0, matched: 0, nearMiss: false,
    winningTerm: term, mismatchReasons: [], lexical: true,
    filters: { yearFrom: row.vehicle_year_from, yearTo: row.vehicle_year_to, model: row.vehicle_model,
               fuelType: row.vehicle_fuel_type, engineModel: row.vehicle_engine_model, vinPattern: row.vin_pattern },
    directPart: null, isSelected: false, isProduction: false,
  }))
}

/**
 * simulateTrace — everything simulate() computes, PLUS what a debugger needs:
 * which term won, cosine + vehicle scores separately, near-misses, non-approved
 * lanes, the pinned direct_part, and the discrete production verdict (so simulator
 * vs production disagreement is visible). Reuses the same expansion, cosine query
 * and scoreVehicleMatch as simulate().
 */
export async function simulateTrace(
  partDescription: string,
  vehicle: SimulateVehicle = {},
  opts: { threshold?: number; nearMissFloor?: number; includeStatuses?: TraceStatus[] } = {},
): Promise<any> {
  const threshold = opts.threshold ?? 0.6
  const nearMissFloor = opts.nearMissFloor ?? 0.45
  const includeStatuses = (opts.includeStatuses?.length ? opts.includeStatuses : ['approved']) as TraceStatus[]
  const db = await getDb()

  // 1) term expansion (track canonical + which terms fired)
  const hasHebrew = /[֐-׿]/.test(partDescription)
  const lang = hasHebrew ? 'he' : 'en'
  const raw = partDescription.toLowerCase().trim()
  const expansion: { term: string; isCanonical: boolean; fired: boolean }[] = [{ term: raw, isCanonical: false, fired: false }]
  try {
    const exp = await db
      .select({ targetWord: wordMappings.targetWord })
      .from(wordMappings)
      .where(and(
        sql`LOWER(${wordMappings.sourceWord}) = LOWER(${partDescription.trim()})`,
        eq(wordMappings.sourceLanguage, lang),
        eq(wordMappings.isActive, true),
      ))
      .orderBy(desc(wordMappings.isDefault), desc(wordMappings.usageCount))
      .limit(5)
    exp.forEach((r, i) => expansion.push({ term: String(r.targetWord).toLowerCase(), isCanonical: i === 0, fired: false }))
  } catch { /* best-effort */ }
  const terms = Array.from(new Set(expansion.map((e) => e.term)))

  // 2) cosine search across the chosen statuses; track the winning term per rule
  const statusList = includeStatuses.map((s) => `'${s}'`).join(',')
  const byId = new Map<string, { row: any; sim: number; winningTerm: string }>()
  let embeddedAny = false
  for (const term of terms) {
    const vec = await embedText(term)
    if (!vec) continue
    embeddedAny = true
    const res = await query(
      `SELECT *, 1 - (part_description_embedding <=> $1::vector) AS similarity
       FROM flow_decisions_with_embeddings
       WHERE status IN (${statusList}) AND part_description_embedding IS NOT NULL
       ORDER BY part_description_embedding <=> $1::vector LIMIT 20`,
      [toVectorLiteral(vec)],
    )
    for (const row of res.rows as any[]) {
      const simv = Number(row.similarity)
      const prev = byId.get(row.id)
      if (!prev || simv > prev.sim) byId.set(row.id, { row, sim: simv, winningTerm: term })
    }
  }

  // No embeddings → lexical fallback so the tracer is never a dead screen.
  if (!embeddedAny) {
    const lex = await getRulesByExactTerm(raw, includeStatuses)
    const productionId = pickProduction(lex.map((c: any) => ({ row: { id: c.id, is_default: c.isDefault }, filterCount: 0, matched: 0 })))
    if (lex[0]) lex[0].isSelected = true
    lex.forEach((c: any) => { c.isProduction = c.id === productionId })
    return { ok: false, mode: 'lexical', reason: 'Embeddings unavailable (no OPENAI_API_KEY) — showing exact/ILIKE lexical matches.',
             expansion, threshold, nearMissFloor, candidates: lex, bestId: lex[0]?.id ?? null, productionId, disagree: false, vehicle }
  }

  // 3) score (keep near-misses down to nearMissFloor)
  const scored = Array.from(byId.values())
    .filter((c) => c.sim >= nearMissFloor)
    .map(({ row, sim, winningTerm }) => {
      const vs = scoreVehicleMatch(row, vehicle)
      const matched = vs.filterCount === 0 ? 0 : Math.round(vs.score * vs.filterCount)
      return { row, sim, winningTerm, matched, ...vs, matchScore: Math.round(sim * vs.score * 1000) / 1000, nearMiss: sim < threshold }
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 20)

  const firedTerms = new Set(scored.map((c) => c.winningTerm))
  for (const e of expansion) e.fired = firedTerms.has(e.term)

  // 4) pinned parts
  const ids = scored.map((c) => c.row.id)
  const pins = new Map<string, any>()
  if (ids.length) {
    const pr = await db.select().from(directParts).where(inArray(directParts.flowDecisionId, ids))
    for (const p of pr) pins.set(p.flowDecisionId, p)
  }

  const selected = scored.filter((c) => !c.nearMiss)   // above threshold = eligible to win
  const best = selected[0] ?? null
  const productionId = pickProduction(selected.map((c) => ({ row: c.row, filterCount: c.filterCount, matched: c.matched })))

  const candidates = scored.map((c) => ({
    id: c.row.id,
    partDescription: c.row.part_description,   // the term THIS rule answers (≠ the query = a neighbor)
    category: c.row.category, subcategory: c.row.subcategory, schema: c.row.schema,
    status: c.row.status, source: c.row.source, isDefault: c.row.is_default, lambdaTarget: c.row.lambda_target,
    cosineSim: Math.round(c.sim * 1000) / 1000, matchScore: c.matchScore, vehicleScore: Math.round(c.score * 100) / 100,
    filterCount: c.filterCount, matched: c.matched, nearMiss: c.nearMiss,
    winningTerm: c.winningTerm, mismatchReasons: c.reasons,
    filters: { yearFrom: c.row.vehicle_year_from, yearTo: c.row.vehicle_year_to, model: c.row.vehicle_model,
               fuelType: c.row.vehicle_fuel_type, engineModel: c.row.vehicle_engine_model, vinPattern: c.row.vin_pattern },
    directPart: pins.get(c.row.id) ?? null,
    isSelected: best ? c.row.id === best.row.id : false,
    isProduction: c.row.id === productionId,
  }))

  return {
    ok: true, mode: 'semantic', expansion, threshold, nearMissFloor, candidates,
    bestId: best?.row.id ?? null, productionId,
    disagree: !!(best && productionId && best.row.id !== productionId),
    vehicle,
  }
}

/** Decode a license plate (or VIN) → vehicle facts from car_records, like Diego does.
 *  decisions store the COMMERCIAL name (trade_name, e.g. '3008'), not the VIN model code. */
export async function resolveVehicleByPlateOrVin(
  idRaw: string,
): Promise<(SimulateVehicle & { vin?: string; note?: string }) | null> {
  const id = (idRaw || '').trim()
  if (!id) return null
  const cols = `vin, model_name, trade_name, engine_model, year_of_manufacture, fuel_type`
  let res = await query(
    `SELECT ${cols} FROM car_records WHERE license_plate=$1 AND vin IS NOT NULL AND vin<>'' ORDER BY date_inserted DESC LIMIT 1`,
    [id],
  ).catch(() => ({ rows: [] as any[] }))
  if (!(res.rows as any[]).length) {
    res = await query(`SELECT ${cols} FROM car_records WHERE vin=$1 ORDER BY date_inserted DESC LIMIT 1`, [id])
      .catch(() => ({ rows: [] as any[] }))
  }
  const r = (res.rows as any[])[0]
  if (!r) return null
  return {
    vin: r.vin,
    model: r.trade_name || r.model_name,
    engineModel: r.engine_model,
    year: r.year_of_manufacture ? Number(r.year_of_manufacture) : undefined,
    fuelType: r.fuel_type,
  }
}

/** Friendly display name for a lambda_target (the manufacturer catalog / scheme). */
const LAMBDA_LABEL: Record<string, string> = { psa: 'PSA', saic: 'SAIC', partslink: 'Partslink' }
export function lambdaLabel(lt?: string | null): string {
  const k = (lt || '').toLowerCase()
  return LAMBDA_LABEL[k] || (lt ? lt.toUpperCase() : '(none)')
}

/** Catalog as a nested scheme → category → subcategory → schema tree (react-d3-tree shape).
 *  The rules span multiple manufacturer catalogs (PSA / SAIC / Partslink) whose category and
 *  subcategory names can collide, so the FIRST split is by lambda_target — otherwise PSA and
 *  SAIC branches would intermix under a single root. */
export async function getCatalogTree(lambda?: string): Promise<any> {
  const lam = lambda ? lambda.replace(/[^a-z0-9_]/gi, '') : ''
  const res = await query(
    `SELECT COALESCE(NULLIF(fd.lambda_target,''),'(none)') AS lambda_target,
            COALESCE(NULLIF(fd.category,''),'(none)') AS category,
            COALESCE(NULLIF(fd.subcategory,''),'(none)') AS subcategory,
            COALESCE(NULLIF(fd.schema,''),'(none)') AS schema,
            count(*)::int AS rules,
            count(*) FILTER (WHERE fd.status='approved')::int AS approved,
            count(*) FILTER (WHERE fd.status='suggestion')::int AS suggestions,
            bool_or(fd.is_default) AS has_generic,
            count(dp.id)::int AS pinned
     FROM flow_decisions_v2 fd
     LEFT JOIN direct_parts dp ON dp.flow_decision_id = fd.id
     WHERE fd.status <> 'rejected' ${lam ? `AND fd.lambda_target = '${lam}'` : ''}
     GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`,
    [],
  )
  const root: any = { name: 'catalog', children: [], attributes: { rules: 0, kind: 'root' } }
  const lams = new Map<string, any>()
  const cats = new Map<string, any>()
  const subs = new Map<string, any>()
  for (const r of res.rows as any[]) {
    let lamNode = lams.get(r.lambda_target)
    if (!lamNode) {
      lamNode = { name: lambdaLabel(r.lambda_target), children: [], attributes: { rules: 0, kind: 'lambda', lambda: r.lambda_target } }
      lams.set(r.lambda_target, lamNode); root.children.push(lamNode)
    }
    const ck = `${r.lambda_target}||${r.category}`
    let cat = cats.get(ck)
    if (!cat) { cat = { name: r.category, children: [], attributes: { rules: 0, kind: 'category' } }; cats.set(ck, cat); lamNode.children.push(cat) }
    const sk = `${ck}||${r.subcategory}`
    let sub = subs.get(sk)
    if (!sub) { sub = { name: r.subcategory, children: [], attributes: { rules: 0, kind: 'subcategory' } }; subs.set(sk, sub); cat.children.push(sub) }
    sub.children.push({ name: r.schema, attributes: { kind: 'schema', rules: r.rules, approved: r.approved, suggestions: r.suggestions, pinned: r.pinned, generic: !!r.has_generic, lambda: r.lambda_target } })
    sub.attributes.rules += r.rules; cat.attributes.rules += r.rules; lamNode.attributes.rules += r.rules; root.attributes.rules += r.rules
  }
  root.children.sort((a: any, b: any) => b.attributes.rules - a.attributes.rules)   // biggest catalog (PSA) first
  return root
}

/** Server-side rule-corpus aggregates for the Analytics tab (never pull the full corpus client-side). */
export async function getRuleStats(): Promise<any> {
  const rows = async (s: string) => (await query(s, [])).rows as any[]
  const [status, source, byCategory, byLambda, scope, confidence, pins, embeddings, totals] = await Promise.all([
    rows(`SELECT status, count(*)::int c FROM flow_decisions_v2 GROUP BY status`),
    rows(`SELECT CASE WHEN source IS NULL OR source='' OR created_by NOT IN ('','system','diego') THEN 'manual' ELSE COALESCE(source,'auto') END src, count(*)::int c
          FROM flow_decisions_v2 WHERE status<>'rejected' GROUP BY 1 ORDER BY c DESC`),
    rows(`SELECT COALESCE(NULLIF(category,''),'(none)') name, count(*)::int c FROM flow_decisions_v2 WHERE status<>'rejected' GROUP BY 1 ORDER BY c DESC LIMIT 12`),
    rows(`SELECT lambda_target name, count(*)::int c FROM flow_decisions_v2 WHERE status<>'rejected' GROUP BY 1 ORDER BY c DESC`),
    rows(`SELECT CASE WHEN vehicle_year_from IS NULL AND vehicle_year_to IS NULL AND vehicle_model IS NULL AND vehicle_fuel_type IS NULL AND vehicle_engine_model IS NULL AND vin_pattern IS NULL THEN 'generic' ELSE 'scoped' END name, count(*)::int c
          FROM flow_decisions_v2 WHERE status<>'rejected' GROUP BY 1`),
    rows(`SELECT (floor(LEAST(GREATEST(COALESCE(confidence,0)::float,0),1)*10)/10)::float bucket, count(*)::int c
          FROM flow_decisions_v2 WHERE status<>'rejected' GROUP BY 1 ORDER BY 1`),
    rows(`SELECT count(*)::int total, count(*) FILTER (WHERE in_stock=false)::int oos FROM direct_parts`),
    rows(`SELECT count(*) FILTER (WHERE embedding IS NOT NULL)::int have, count(*) FILTER (WHERE embedding IS NULL)::int missing FROM part_descriptions`).catch(() => [{ have: 0, missing: 0 }]),
    rows(`SELECT count(*)::int rules, count(DISTINCT part_description)::int parts FROM flow_decisions_v2 WHERE status<>'rejected'`),
  ])
  return { status, source, byCategory, byLambda, scope, confidence, pins: pins[0], embeddings: embeddings[0], totals: totals[0] }
}
