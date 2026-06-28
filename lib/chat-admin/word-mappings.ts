/**
 * Word-mapping data access for the integrated chat admin.
 *
 * Ported from jsp-chat-js's WordMappingService, rewritten onto the dashboard's
 * raw `query()` (lib/db) against the shared Neon `word_mappings` /
 * `word_mapping_suggestions` tables. No Prisma. Returns camelCase shapes the
 * ported UI expects.
 */

import { query, getPool } from '@/lib/db'

export type MappingType = 'translation' | 'synonym'

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

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToMapping(r: any): WordMapping {
  return {
    id: r.id,
    sourceWord: r.source_word,
    sourceLanguage: r.source_language,
    targetWord: r.target_word,
    targetLanguage: r.target_language,
    mappingType: r.mapping_type,
    confidence: parseFloat(r.confidence?.toString() ?? '1.0'),
    usageCount: r.usage_count ?? 0,
    isActive: r.is_active,
    isDefault: r.is_default ?? false,
    category: r.category,
    metadata: r.metadata,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastUsedAt: r.last_used_at,
  }
}

function rowToSuggestion(r: any): WordMappingSuggestion {
  return {
    id: r.id,
    sourceWord: r.source_word,
    sourceLanguage: r.source_language,
    targetWord: r.target_word,
    targetLanguage: r.target_language,
    mappingType: r.mapping_type,
    confidence: parseFloat(r.confidence?.toString() ?? '0'),
    evidence: r.evidence,
    status: r.status,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    reviewedBy: r.reviewed_by,
    rejectionReason: r.rejection_reason,
  }
}

function normalizeWord(word: string, language: string): string {
  return language === 'en' ? word.trim().toLowerCase() : word.trim()
}

export async function getAllMappings(filters: FilterOptions = {}): Promise<{
  items: WordMapping[]
  total: number
  page: number
  pageSize: number
}> {
  const page = filters.page || 1
  const pageSize = filters.pageSize || 50
  const offset = (page - 1) * pageSize

  const conds: string[] = []
  const params: any[] = []
  const add = (sql: string, val: any) => {
    params.push(val)
    conds.push(sql.replace('$?', `$${params.length}`))
  }

  if (filters.isActive !== undefined) add('is_active = $?', filters.isActive)
  if (filters.mappingType) add('mapping_type = $?', filters.mappingType)
  if (filters.language) {
    params.push(filters.language)
    conds.push(`(source_language = $${params.length} OR target_language = $${params.length})`)
  }
  if (filters.firstLetter) {
    params.push(`${filters.firstLetter.toLowerCase()}%`)
    conds.push(`(source_word ILIKE $${params.length} OR target_word ILIKE $${params.length})`)
  }
  if (filters.searchSource) add('source_word ILIKE $?', `%${filters.searchSource}%`)
  if (filters.searchTarget) add('target_word ILIKE $?', `%${filters.searchTarget}%`)
  if (filters.search) {
    params.push(`%${filters.search}%`)
    conds.push(`(source_word ILIKE $${params.length} OR target_word ILIKE $${params.length})`)
  }

  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : ''

  const sortCol = (
    {
      sourceWord: 'source_word',
      targetWord: 'target_word',
      usageCount: 'usage_count',
      createdAt: 'created_at',
    } as const
  )[filters.sortBy || 'usageCount']
  const sortOrder = (filters.sortOrder || (sortCol === 'usage_count' ? 'desc' : 'asc')).toUpperCase() === 'DESC' ? 'DESC' : 'ASC'
  const orderBy =
    sortCol === 'created_at' ? `ORDER BY created_at ${sortOrder}` : `ORDER BY ${sortCol} ${sortOrder}, created_at DESC`

  const listParams = [...params, pageSize, offset]
  const [itemsRes, countRes] = await Promise.all([
    query(
      `SELECT * FROM word_mappings ${where} ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams,
    ),
    query(`SELECT COUNT(*)::int AS total FROM word_mappings ${where}`, params),
  ])

  return {
    items: itemsRes.rows.map(rowToMapping),
    total: countRes.rows[0]?.total ?? 0,
    page,
    pageSize,
  }
}

export async function getMapping(id: string): Promise<WordMapping | null> {
  const res = await query('SELECT * FROM word_mappings WHERE id = $1', [id])
  return res.rows[0] ? rowToMapping(res.rows[0]) : null
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
  const sourceWord = normalizeWord(data.sourceWord, data.sourceLanguage)
  const targetWord = normalizeWord(data.targetWord, data.targetLanguage)

  const dup = await query(
    `SELECT id FROM word_mappings
     WHERE source_word = $1 AND source_language = $2 AND target_word = $3 AND target_language = $4`,
    [sourceWord, data.sourceLanguage, targetWord, data.targetLanguage],
  )
  if (dup.rows[0]) {
    throw new Error(
      `Mapping already exists: ${sourceWord} (${data.sourceLanguage}) → ${targetWord} (${data.targetLanguage})`,
    )
  }

  const res = await query(
    `INSERT INTO word_mappings
       (source_word, source_language, target_word, target_language, mapping_type, category, metadata, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     RETURNING *`,
    [
      sourceWord,
      data.sourceLanguage,
      targetWord,
      data.targetLanguage,
      data.mappingType,
      data.category ?? null,
      data.metadata != null ? JSON.stringify(data.metadata) : null,
      data.createdBy ?? null,
    ],
  )
  return rowToMapping(res.rows[0])
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
  const sets: string[] = []
  const params: any[] = []
  const set = (col: string, val: any) => {
    params.push(val)
    sets.push(`${col} = $${params.length}`)
  }

  if (data.sourceWord !== undefined) set('source_word', normalizeWord(data.sourceWord, data.sourceLanguage || 'he'))
  if (data.sourceLanguage !== undefined) set('source_language', data.sourceLanguage)
  if (data.targetWord !== undefined) set('target_word', normalizeWord(data.targetWord, data.targetLanguage || 'he'))
  if (data.targetLanguage !== undefined) set('target_language', data.targetLanguage)
  if (data.mappingType !== undefined) set('mapping_type', data.mappingType)
  if (data.confidence !== undefined) set('confidence', data.confidence)
  if (data.isActive !== undefined) set('is_active', data.isActive)
  if (data.category !== undefined) set('category', data.category)
  if (data.metadata !== undefined) set('metadata', data.metadata != null ? JSON.stringify(data.metadata) : null)
  sets.push('updated_at = NOW()')

  params.push(id)
  const res = await query(
    `UPDATE word_mappings SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params,
  )
  if (!res.rows[0]) {
    const err = new Error('Word mapping not found') as Error & { code?: string }
    err.code = 'P2025'
    throw err
  }
  return rowToMapping(res.rows[0])
}

export async function deleteMapping(id: string): Promise<void> {
  const res = await query('DELETE FROM word_mappings WHERE id = $1', [id])
  if (res.rowCount === 0) {
    const err = new Error('Word mapping not found') as Error & { code?: string }
    err.code = 'P2025'
    throw err
  }
}

export async function setDefaultMapping(id: string): Promise<WordMapping> {
  const pool = await getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const cur = await client.query('SELECT * FROM word_mappings WHERE id = $1 FOR UPDATE', [id])
    if (!cur.rows[0]) throw new Error(`Word mapping not found: ${id}`)
    const m = cur.rows[0]
    await client.query(
      `UPDATE word_mappings SET is_default = false
       WHERE source_word = $1 AND source_language = $2 AND target_language = $3 AND is_default = true`,
      [m.source_word, m.source_language, m.target_language],
    )
    const updated = await client.query(
      'UPDATE word_mappings SET is_default = true, updated_at = NOW() WHERE id = $1 RETURNING *',
      [id],
    )
    await client.query('COMMIT')
    return rowToMapping(updated.rows[0])
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

/* ── Suggestions ─────────────────────────────────────────────────────── */

export async function getPendingSuggestions(limit = 50): Promise<WordMappingSuggestion[]> {
  const res = await query(
    `SELECT * FROM word_mapping_suggestions
     WHERE status = 'pending'
     ORDER BY confidence DESC, created_at DESC
     LIMIT $1`,
    [limit],
  )
  return res.rows.map(rowToSuggestion)
}

/** Approve a suggestion: insert the mapping + flip suggestion status, atomically. */
export async function approveSuggestion(suggestionId: string, reviewedBy = 'admin'): Promise<void> {
  const pool = await getPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const sres = await client.query(
      `SELECT * FROM word_mapping_suggestions WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [suggestionId],
    )
    const s = sres.rows[0]
    if (!s) throw new Error('Suggestion not found')

    await client.query(
      `INSERT INTO word_mappings
         (source_word, source_language, target_word, target_language, mapping_type, confidence, created_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (source_word, source_language, target_word, target_language) DO NOTHING`,
      [
        s.source_word,
        s.source_language,
        s.target_word,
        s.target_language,
        s.mapping_type,
        parseFloat(s.confidence?.toString() ?? '0.5'),
        reviewedBy,
      ],
    )
    await client.query(
      `UPDATE word_mapping_suggestions
       SET status = 'approved', reviewed_at = NOW(), reviewed_by = $2
       WHERE id = $1`,
      [suggestionId, reviewedBy],
    )
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export async function rejectSuggestion(
  suggestionId: string,
  reason?: string,
  reviewedBy = 'admin',
): Promise<void> {
  const res = await query(
    `UPDATE word_mapping_suggestions
     SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $2, rejection_reason = $3
     WHERE id = $1 AND status = 'pending'`,
    [suggestionId, reviewedBy, reason ?? null],
  )
  if (res.rowCount === 0) throw new Error('Suggestion not found')
}

/* ── Graph (ported verbatim from WordMappingService) ─────────────────── */

export async function getGraphData(
  language: 'en' | 'he' | 'ar',
  rootLetter?: string,
): Promise<GraphNode> {
  const res = await query(
    `SELECT * FROM word_mappings
     WHERE (source_language = $1 OR target_language = $1) AND is_active = true
     ORDER BY source_word ASC`,
    [language],
  )
  const mappings = res.rows
  return rootLetter
    ? buildWordNodesForLetter(mappings, language, rootLetter)
    : buildLetterRootNode(mappings, language)
}

function buildLetterRootNode(mappings: any[], language: string): GraphNode {
  const letters = new Set<string>()
  for (const m of mappings) {
    if (m.source_language === language) letters.add(m.source_word.charAt(0).toLowerCase())
    if (m.target_language === language) letters.add(m.target_word.charAt(0).toLowerCase())
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
            (m.source_language === language && m.source_word.toLowerCase().startsWith(letter)) ||
            (m.target_language === language && m.target_word.toLowerCase().startsWith(letter)),
        ).length,
      },
    })),
  }
}

function buildWordNodesForLetter(mappings: any[], language: string, letter: string): GraphNode {
  const letterLower = letter.toLowerCase()
  const words = new Map<string, { word: string; connections: string[]; type: string[] }>()
  for (const m of mappings) {
    if (m.source_language === language && m.source_word.toLowerCase().startsWith(letterLower)) {
      if (!words.has(m.source_word)) words.set(m.source_word, { word: m.source_word, connections: [], type: [] })
      words.get(m.source_word)!.connections.push(m.target_word)
      words.get(m.source_word)!.type.push(m.mapping_type)
    }
    if (m.target_language === language && m.target_word.toLowerCase().startsWith(letterLower)) {
      if (!words.has(m.target_word)) words.set(m.target_word, { word: m.target_word, connections: [], type: [] })
      words.get(m.target_word)!.connections.push(m.source_word)
      words.get(m.target_word)!.type.push(m.mapping_type)
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
        language:
          mappings.find((m) => m.target_word === conn || m.source_word === conn)?.target_language || 'en',
      })),
    })),
  }
}
