/**
 * Word-mapping data access for the integrated chat admin.
 * Drizzle ORM over the shared `word_mappings` / `word_mapping_suggestions`
 * tables. Returns camelCase shapes the ported UI expects.
 */

import { and, asc, desc, eq, ilike, or, count } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { wordMappings, wordMappingSuggestions } from '@/lib/db/schema'

export type MappingType = 'translation' | 'synonym'

type MappingRow = typeof wordMappings.$inferSelect
type SuggestionRow = typeof wordMappingSuggestions.$inferSelect

export interface WordMapping {
  id: string
  sourceWord: string
  sourceLanguage: string
  targetWord: string
  targetLanguage: string
  mappingType: MappingType
  confidence: number
  usageCount: number
  isActive: boolean
  isDefault: boolean
  category?: string | null
  metadata?: unknown
  createdBy?: string | null
  createdAt: Date | string
  updatedAt: Date | string
  lastUsedAt?: Date | string | null
}

export interface WordMappingSuggestion {
  id: string
  sourceWord: string
  sourceLanguage: string
  targetWord: string
  targetLanguage: string
  mappingType: MappingType
  confidence: number
  evidence: unknown
  status: string
  createdAt: Date | string
  reviewedAt?: Date | string | null
  reviewedBy?: string | null
  rejectionReason?: string | null
}

export interface FilterOptions {
  page?: number
  pageSize?: number
  search?: string
  searchSource?: string
  searchTarget?: string
  language?: string
  mappingType?: MappingType
  isActive?: boolean
  firstLetter?: string
  sortBy?: 'sourceWord' | 'targetWord' | 'usageCount' | 'createdAt'
  sortOrder?: 'asc' | 'desc'
}

export interface GraphNode {
  name: string
  type: 'letter' | 'word'
  language: string
  attributes?: Record<string, unknown>
  children?: GraphNode[]
}

function rowToMapping(r: MappingRow): WordMapping {
  return {
    id: r.id,
    sourceWord: r.sourceWord,
    sourceLanguage: r.sourceLanguage,
    targetWord: r.targetWord,
    targetLanguage: r.targetLanguage,
    mappingType: r.mappingType,
    confidence: parseFloat(r.confidence ?? '1.0'),
    usageCount: r.usageCount,
    isActive: r.isActive,
    isDefault: r.isDefault,
    category: r.category,
    metadata: r.metadata,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    lastUsedAt: r.lastUsedAt,
  }
}

function rowToSuggestion(r: SuggestionRow): WordMappingSuggestion {
  return {
    id: r.id,
    sourceWord: r.sourceWord,
    sourceLanguage: r.sourceLanguage,
    targetWord: r.targetWord,
    targetLanguage: r.targetLanguage,
    mappingType: r.mappingType,
    confidence: parseFloat(r.confidence ?? '0'),
    evidence: r.evidence,
    status: r.status,
    createdAt: r.createdAt,
    reviewedAt: r.reviewedAt,
    reviewedBy: r.reviewedBy,
    rejectionReason: r.rejectionReason,
  }
}

const normalizeWord = (word: string, language: string) =>
  language === 'en' ? word.trim().toLowerCase() : word.trim()

export async function getAllMappings(filters: FilterOptions = {}): Promise<{
  items: WordMapping[]
  total: number
  page: number
  pageSize: number
}> {
  const db = await getDb()
  const page = Math.max(1, filters.page || 1)
  const pageSize = Math.min(2000, Math.max(1, filters.pageSize || 50))
  const offset = (page - 1) * pageSize

  const conds = []
  if (filters.isActive !== undefined) conds.push(eq(wordMappings.isActive, filters.isActive))
  if (filters.mappingType) conds.push(eq(wordMappings.mappingType, filters.mappingType))
  if (filters.language)
    conds.push(or(eq(wordMappings.sourceLanguage, filters.language), eq(wordMappings.targetLanguage, filters.language)))
  if (filters.firstLetter) {
    const p = `${filters.firstLetter.toLowerCase()}%`
    conds.push(or(ilike(wordMappings.sourceWord, p), ilike(wordMappings.targetWord, p)))
  }
  if (filters.searchSource) conds.push(ilike(wordMappings.sourceWord, `%${filters.searchSource}%`))
  if (filters.searchTarget) conds.push(ilike(wordMappings.targetWord, `%${filters.searchTarget}%`))
  if (filters.search)
    conds.push(or(ilike(wordMappings.sourceWord, `%${filters.search}%`), ilike(wordMappings.targetWord, `%${filters.search}%`)))
  const where = conds.length ? and(...conds) : undefined

  const sortColMap = {
    sourceWord: wordMappings.sourceWord,
    targetWord: wordMappings.targetWord,
    usageCount: wordMappings.usageCount,
    createdAt: wordMappings.createdAt,
  } as const
  const sortBy = filters.sortBy || 'usageCount'
  const col = sortColMap[sortBy]
  const dir = (filters.sortOrder || (sortBy === 'usageCount' ? 'desc' : 'asc')) === 'desc' ? desc : asc
  const orderBy = sortBy === 'createdAt' ? [dir(col)] : [dir(col), desc(wordMappings.createdAt)]

  const [items, totalRes] = await Promise.all([
    db.select().from(wordMappings).where(where).orderBy(...orderBy).limit(pageSize).offset(offset),
    db.select({ value: count() }).from(wordMappings).where(where),
  ])

  return { items: items.map(rowToMapping), total: totalRes[0]?.value ?? 0, page, pageSize }
}

export async function getMapping(id: string): Promise<WordMapping | null> {
  const db = await getDb()
  const [row] = await db.select().from(wordMappings).where(eq(wordMappings.id, id)).limit(1)
  return row ? rowToMapping(row) : null
}

export async function createMapping(data: {
  sourceWord: string
  sourceLanguage: string
  targetWord: string
  targetLanguage: string
  mappingType: MappingType
  category?: string | null
  metadata?: unknown
  createdBy?: string | null
}): Promise<WordMapping> {
  const db = await getDb()
  const sourceWord = normalizeWord(data.sourceWord, data.sourceLanguage)
  const targetWord = normalizeWord(data.targetWord, data.targetLanguage)

  const [dup] = await db
    .select({ id: wordMappings.id })
    .from(wordMappings)
    .where(
      and(
        eq(wordMappings.sourceWord, sourceWord),
        eq(wordMappings.sourceLanguage, data.sourceLanguage),
        eq(wordMappings.targetWord, targetWord),
        eq(wordMappings.targetLanguage, data.targetLanguage),
      ),
    )
    .limit(1)
  if (dup) {
    throw new Error(
      `Mapping already exists: ${sourceWord} (${data.sourceLanguage}) → ${targetWord} (${data.targetLanguage})`,
    )
  }

  const [row] = await db
    .insert(wordMappings)
    .values({
      sourceWord,
      sourceLanguage: data.sourceLanguage,
      targetWord,
      targetLanguage: data.targetLanguage,
      mappingType: data.mappingType,
      category: data.category ?? null,
      metadata: data.metadata ?? null,
      createdBy: data.createdBy ?? null,
      updatedAt: new Date(),
    })
    .returning()
  return rowToMapping(row)
}

export async function updateMapping(
  id: string,
  data: {
    sourceWord?: string
    sourceLanguage?: string
    targetWord?: string
    targetLanguage?: string
    mappingType?: MappingType
    confidence?: number
    isActive?: boolean
    category?: string | null
    metadata?: unknown
  },
): Promise<WordMapping> {
  const db = await getDb()
  const set: Partial<typeof wordMappings.$inferInsert> = { updatedAt: new Date() }
  if (data.sourceWord !== undefined) set.sourceWord = normalizeWord(data.sourceWord, data.sourceLanguage || 'he')
  if (data.sourceLanguage !== undefined) set.sourceLanguage = data.sourceLanguage
  if (data.targetWord !== undefined) set.targetWord = normalizeWord(data.targetWord, data.targetLanguage || 'he')
  if (data.targetLanguage !== undefined) set.targetLanguage = data.targetLanguage
  if (data.mappingType !== undefined) set.mappingType = data.mappingType
  if (data.confidence !== undefined) set.confidence = String(data.confidence)
  if (data.isActive !== undefined) set.isActive = data.isActive
  if (data.category !== undefined) set.category = data.category
  if (data.metadata !== undefined) set.metadata = data.metadata

  const [row] = await db.update(wordMappings).set(set).where(eq(wordMappings.id, id)).returning()
  if (!row) {
    const err = new Error('Word mapping not found') as Error & { code?: string }
    err.code = 'P2025'
    throw err
  }
  return rowToMapping(row)
}

export async function deleteMapping(id: string): Promise<void> {
  const db = await getDb()
  const deleted = await db.delete(wordMappings).where(eq(wordMappings.id, id)).returning({ id: wordMappings.id })
  if (deleted.length === 0) {
    const err = new Error('Word mapping not found') as Error & { code?: string }
    err.code = 'P2025'
    throw err
  }
}

export async function setDefaultMapping(id: string): Promise<WordMapping> {
  const db = await getDb()
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(wordMappings).where(eq(wordMappings.id, id)).for('update').limit(1)
    if (!m) throw new Error(`Word mapping not found: ${id}`)
    await tx
      .update(wordMappings)
      .set({ isDefault: false })
      .where(
        and(
          eq(wordMappings.sourceWord, m.sourceWord),
          eq(wordMappings.sourceLanguage, m.sourceLanguage),
          eq(wordMappings.targetLanguage, m.targetLanguage),
          eq(wordMappings.isDefault, true),
        ),
      )
    const [updated] = await tx
      .update(wordMappings)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(wordMappings.id, id))
      .returning()
    return rowToMapping(updated)
  })
}

/* ── Suggestions ─────────────────────────────────────────────────────── */

export async function getPendingSuggestions(limit = 50): Promise<WordMappingSuggestion[]> {
  const db = await getDb()
  const rows = await db
    .select()
    .from(wordMappingSuggestions)
    .where(eq(wordMappingSuggestions.status, 'pending'))
    .orderBy(desc(wordMappingSuggestions.confidence), desc(wordMappingSuggestions.createdAt))
    .limit(limit)
  return rows.map(rowToSuggestion)
}

/** Approve a suggestion: insert the mapping + flip suggestion status, atomically. */
export async function approveSuggestion(suggestionId: string, reviewedBy = 'admin'): Promise<void> {
  const db = await getDb()
  await db.transaction(async (tx) => {
    const [s] = await tx
      .select()
      .from(wordMappingSuggestions)
      .where(and(eq(wordMappingSuggestions.id, suggestionId), eq(wordMappingSuggestions.status, 'pending')))
      .for('update')
      .limit(1)
    if (!s) throw new Error('Suggestion not found')

    await tx
      .insert(wordMappings)
      .values({
        // Normalize (English → lowercase) to match createMapping, so an approved
        // suggestion can't create a case-variant duplicate of an existing mapping.
        sourceWord: normalizeWord(s.sourceWord, s.sourceLanguage),
        sourceLanguage: s.sourceLanguage,
        targetWord: normalizeWord(s.targetWord, s.targetLanguage),
        targetLanguage: s.targetLanguage,
        mappingType: s.mappingType,
        confidence: s.confidence,
        createdBy: reviewedBy,
        updatedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [
          wordMappings.sourceWord,
          wordMappings.sourceLanguage,
          wordMappings.targetWord,
          wordMappings.targetLanguage,
        ],
      })

    await tx
      .update(wordMappingSuggestions)
      .set({ status: 'approved', reviewedAt: new Date(), reviewedBy })
      .where(eq(wordMappingSuggestions.id, suggestionId))
  })
}

export async function rejectSuggestion(
  suggestionId: string,
  reason?: string,
  reviewedBy = 'admin',
): Promise<void> {
  const db = await getDb()
  const updated = await db
    .update(wordMappingSuggestions)
    .set({ status: 'rejected', reviewedAt: new Date(), reviewedBy, rejectionReason: reason ?? null })
    .where(and(eq(wordMappingSuggestions.id, suggestionId), eq(wordMappingSuggestions.status, 'pending')))
    .returning({ id: wordMappingSuggestions.id })
  if (updated.length === 0) throw new Error('Suggestion not found')
}

/* ── Graph ───────────────────────────────────────────────────────────── */

export async function getGraphData(language: 'en' | 'he' | 'ar', rootLetter?: string): Promise<GraphNode> {
  const db = await getDb()
  const mappings = await db
    .select()
    .from(wordMappings)
    .where(
      and(
        or(eq(wordMappings.sourceLanguage, language), eq(wordMappings.targetLanguage, language)),
        eq(wordMappings.isActive, true),
      ),
    )
    .orderBy(asc(wordMappings.sourceWord))
  return rootLetter
    ? buildWordNodesForLetter(mappings, language, rootLetter)
    : buildLetterRootNode(mappings, language)
}

function buildLetterRootNode(mappings: MappingRow[], language: string): GraphNode {
  const letters = new Set<string>()
  for (const m of mappings) {
    if (m.sourceLanguage === language) letters.add(m.sourceWord.charAt(0).toLowerCase())
    if (m.targetLanguage === language) letters.add(m.targetWord.charAt(0).toLowerCase())
  }
  const sorted = Array.from(letters).sort((a, b) => a.localeCompare(b, language))
  return {
    name: language === 'he' ? 'עברית' : 'English',
    type: 'letter',
    language,
    children: sorted.map((letter) => ({
      name: letter.toUpperCase(),
      type: 'letter' as const,
      language,
      attributes: {
        wordCount: mappings.filter(
          (m) =>
            (m.sourceLanguage === language && m.sourceWord.toLowerCase().startsWith(letter)) ||
            (m.targetLanguage === language && m.targetWord.toLowerCase().startsWith(letter)),
        ).length,
      },
    })),
  }
}

function buildWordNodesForLetter(mappings: MappingRow[], language: string, letter: string): GraphNode {
  const letterLower = letter.toLowerCase()
  const words = new Map<string, { word: string; connections: string[]; type: string[] }>()
  for (const m of mappings) {
    if (m.sourceLanguage === language && m.sourceWord.toLowerCase().startsWith(letterLower)) {
      if (!words.has(m.sourceWord)) words.set(m.sourceWord, { word: m.sourceWord, connections: [], type: [] })
      words.get(m.sourceWord)!.connections.push(m.targetWord)
      words.get(m.sourceWord)!.type.push(m.mappingType)
    }
    if (m.targetLanguage === language && m.targetWord.toLowerCase().startsWith(letterLower)) {
      if (!words.has(m.targetWord)) words.set(m.targetWord, { word: m.targetWord, connections: [], type: [] })
      words.get(m.targetWord)!.connections.push(m.sourceWord)
      words.get(m.targetWord)!.type.push(m.mappingType)
    }
  }
  return {
    name: letter.toUpperCase(),
    type: 'letter',
    language,
    children: Array.from(words.values()).map(({ word, connections, type }) => ({
      name: word,
      type: 'word' as const,
      language,
      attributes: { connections, mappingTypes: type },
      children: connections.map((conn) => ({
        name: conn,
        type: 'word' as const,
        language: mappings.find((m) => m.targetWord === conn || m.sourceWord === conn)?.targetLanguage || 'en',
      })),
    })),
  }
}
