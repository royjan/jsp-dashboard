import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { getCached, setCache } from '@/lib/redis-client'

export const dynamic = 'force-dynamic'

// Dora writes supplier names as free text in mixed Hebrew/English/slug forms
// ("Lubinski / דוד לובינסקי בע\"מ", slug "lubinski"). Finansit supplier cards
// are matched by pg_trgm similarity over the purchase-side documents
// (formats 51/53/58/61/62/66 — on purchase docs the "customer" IS the supplier),
// with Latin slugs transliterated to Hebrew so "lubinski" can meet "לובינסקי".
const TRANSLIT: Record<string, string> = {
  b: 'ב', c: 'ק', d: 'ד', f: 'פ', g: 'ג', h: 'ה', k: 'ק', l: 'ל', m: 'מ',
  n: 'נ', p: 'פ', q: 'ק', r: 'ר', s: 'ס', t: 'ט', v: 'ב', w: 'ו', x: 'קס',
  z: 'ז', u: 'ו', o: 'ו', i: 'י', y: 'י',
}

function transliterate(slug: string): string {
  return slug
    .toLowerCase()
    .split(/[-_\s]+/)
    .map((w) =>
      [...w]
        .map((ch, i) => {
          if (ch === 'a' || ch === 'e') return i === 0 ? 'א' : ''
          return TRANSLIT[ch] || ''
        })
        .join('')
    )
    .join(' ')
}

interface SupplierMatch {
  code: string
  name: string
  score: number
  // Most local suppliers are also clients under a separate 3xxxx card (often
  // literally named "...לקוח"). The /customers page is the rich view, so the UI
  // links there when a twin exists; the 4xxxx supplier card has no usable page
  // for non-import suppliers.
  customer_code: string | null
  customer_name: string | null
}

// Strips legal/generic boilerplate so "חלקי חילוף לרכב בע"מ" can't dominate the
// similarity score. Same cleaning is applied SQL-side to the card names.
const GENERIC_RE = /בע["״׳']?מ|חלקי חילוף|לרכב|חברה|לקוח|ספק|בעמ|ltd\.?|inc\.?/gi

function variantsFor(name: string | null, slug: string | null): string[] {
  const out = new Set<string>()
  for (const part of (name || '').split('/')) {
    const v = part.replace(GENERIC_RE, ' ').replace(/[^א-תa-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    if (v.length >= 3) out.add(v)
  }
  if (slug) {
    const t = transliterate(slug)
    if (t.length >= 3) out.add(t)
  }
  return [...out]
}

// pg_trgm-style trigram similarity computed in JS: SQL-side similarity over the
// whole documents table timed out (each call is a full-table scan), while the
// card pools themselves are small enough to score in-process.
function trigrams(s: string): Set<string> {
  const out = new Set<string>()
  for (const w of s.toLowerCase().split(/\s+/).filter(Boolean)) {
    const padded = `  ${w} `
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3))
  }
  return out
}

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

interface Card {
  code: string
  name: string
  cnt: number
  tri: Set<string>
}

function cleanName(s: string): string {
  return s.replace(GENERIC_RE, ' ').replace(/[^א-תa-zA-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function cardPool(formats: string[]): Promise<Card[]> {
  const res = await query(
    `SELECT customer_code AS code, MAX(customer_name) AS name, COUNT(*)::int AS cnt
       FROM dashboard.documents
      WHERE format = ANY($1::text[]) AND customer_code <> '' AND customer_name IS NOT NULL
      GROUP BY customer_code`,
    [formats]
  )
  return res.rows.map((r: any) => ({
    code: r.code,
    name: r.name,
    cnt: r.cnt,
    tri: trigrams(cleanName(r.name)),
  }))
}

function bestCard(variants: string[], pool: Card[], excludeCode?: string): { code: string; name: string; best: number } | null {
  const varTris = variants.map(trigrams)
  const scored = pool
    .filter((c) => c.code !== excludeCode)
    .map((c) => ({ ...c, best: Math.max(...varTris.map((v) => similarity(v, c.tri))) }))
    .filter((c) => c.best >= 0.3)
    .sort((a, b) => b.best - a.best)
  if (scored.length === 0) return null
  // Near-tied scores (e.g. "סוכניות אפק -רקורד" vs "רקורד-סמי אהרון") resolve
  // to the card with the most documents.
  const top = scored[0].best
  const pick = scored.filter((c) => top - c.best <= 0.05).sort((a, b) => b.cnt - a.cnt)[0]
  return { code: pick.code, name: pick.name, best: pick.best }
}

async function matchSuppliers(
  keys: Array<{ key: string; name: string | null; slug: string | null }>
): Promise<Record<string, SupplierMatch | null>> {
  const [supplierPool, customerPool] = await Promise.all([
    cardPool(['51', '53', '58', '61', '62', '66']),
    cardPool(['11', '12', '14', '21', '31', '35']),
  ])
  const result: Record<string, SupplierMatch | null> = {}
  for (const { key, name, slug } of keys) {
    const variants = variantsFor(name, slug)
    if (variants.length === 0) {
      result[key] = null
      continue
    }
    const supplier = bestCard(variants, supplierPool)
    if (!supplier) {
      result[key] = null
      continue
    }
    // The twin is the same company as the matched supplier card, so its cleaned
    // name is the strongest signal ("רקורד-סמי אהרון כהן" finds "רקורד-סמי אהרון
    // בע\"מ לקוח" where Dora's bare "רקורד" would drift to a lookalike card).
    // Supplier cards can carry stray sales docs — the twin must be a different card.
    const customer = bestCard([cleanName(supplier.name), ...variants], customerPool, supplier.code)
    result[key] = {
      code: supplier.code,
      name: supplier.name,
      score: Number(supplier.best.toFixed(3)),
      customer_code: customer?.code ?? null,
      customer_name: customer?.name ?? null,
    }
  }
  return result
}

/**
 * GET /api/dora/credits — Dora's supplier-credit cases (זיכויים והחזרות).
 *
 * Source: Neon schema `dora` — a real-time trigger mirror of Dora's local
 * brain DB (LXC 104), so this reflects her case tracking within seconds.
 * Each case is enriched with its best-matching Finansit supplier card.
 */
export async function GET() {
  try {
    await initializeSecrets()
    const res = await query(
      `SELECT id, external_ref, title, status, owner, notes, metadata,
              created_at, updated_at, follow_up_at, closed_at
         FROM dora.brain_tasks
        WHERE category = 'supplier_credit'
        ORDER BY updated_at DESC
        LIMIT 500`
    )

    const keyOf = (md: any) => `${md?.supplier_slug || ''}|${md?.supplier_name || ''}`
    const distinct = new Map<string, { key: string; name: string | null; slug: string | null }>()
    for (const c of res.rows) {
      const md = c.metadata || {}
      const key = keyOf(md)
      if (key !== '|' && !distinct.has(key)) {
        distinct.set(key, { key, name: md.supplier_name || null, slug: md.supplier_slug || null })
      }
    }

    let matches: Record<string, SupplierMatch | null> = {}
    if (distinct.size > 0) {
      const cacheKey = `dora:supplier-match:v3:${[...distinct.keys()].sort().join('~')}`
      const cached = await getCached<Record<string, SupplierMatch | null>>(cacheKey)
      if (cached) {
        matches = cached
      } else {
        matches = await matchSuppliers([...distinct.values()])
        await setCache(cacheKey, matches, 48 * 3600)
      }
    }

    const cases = res.rows.map((c: any) => ({
      ...c,
      supplier_match: matches[keyOf(c.metadata)] ?? null,
    }))
    return NextResponse.json({ success: true, cases })
  } catch (e) {
    console.error('[dora/credits]', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
