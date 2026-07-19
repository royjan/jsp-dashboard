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

async function matchSuppliers(
  keys: Array<{ key: string; name: string | null; slug: string | null }>
): Promise<Record<string, SupplierMatch | null>> {
  const result: Record<string, SupplierMatch | null> = {}
  for (const { key, name, slug } of keys) {
    const variants = variantsFor(name, slug)
    if (variants.length === 0) {
      result[key] = null
      continue
    }
    const res = await query(
      `SELECT code, name, best, cnt FROM (
         SELECT customer_code AS code, MAX(customer_name) AS name, COUNT(*)::int AS cnt,
                MAX((SELECT MAX(similarity(
                  regexp_replace(regexp_replace(customer_name,
                    'בע["״׳'']?מ|חלקי חילוף|לרכב|חברה|לקוח|ספק|בעמ', '', 'g'),
                    '[^א-תa-zA-Z0-9 ]', ' ', 'g'),
                  v)) FROM unnest($1::text[]) v)) AS best
           FROM dashboard.documents
          WHERE format IN ('51','53','58','61','62','66') AND customer_code <> ''
          GROUP BY customer_code) t
        WHERE best >= 0.3
        ORDER BY best DESC, cnt DESC
        LIMIT 5`,
      [variants]
    )
    if (res.rows.length === 0) {
      result[key] = null
      continue
    }
    // Near-tied scores (e.g. "סוכניות אפק -רקורד" vs "רקורד-סמי אהרון") resolve
    // to the card we actually buy from the most.
    const top = Number(res.rows[0].best)
    const pick = res.rows
      .filter((r: any) => top - Number(r.best) <= 0.05)
      .sort((a: any, b: any) => b.cnt - a.cnt)[0]
    result[key] = { code: pick.code, name: pick.name, score: Number(Number(pick.best).toFixed(3)) }
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
      const cacheKey = `dora:supplier-match:v1:${[...distinct.keys()].sort().join('~')}`
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
