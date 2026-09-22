import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { getCached, setCache } from '@/lib/redis-client'
import { familyOf, sharesNumbering, type BrandFamily } from '@/lib/brand'

/**
 * GET /api/catalog/cross-brand — every cross-brand relation in the catalogue.
 *
 * Two kinds, one graph:
 *  · `codes`   — item numbers printed by more than one brand family's cars.
 *                Either a shared numbering scheme (Fiat with PSA, MG with
 *                Opel — usually the same part) or a collision (Volvo with PSA —
 *                a different part under the same number).
 *  · `matches` — partly.part_links pairs whose two sides are different brands:
 *                the same part under two numbers (PSA 8335VP = Toyota SU001A2053).
 *
 * The same-number half needs every project_parts row grouped by (part, family),
 * so the whole answer is cached for 30 minutes; filters are applied after the
 * cache, cheaply. Demo vehicles count: a trial scan of a Volvo is still Volvo's
 * catalog printing the number.
 *
 * Query params: kind=all|collisions|shared|matches, family=<BrandFamily>,
 * q=<code or name substring>, limit=<nodes, default 200, max 600>.
 */

interface CodeRel {
  code: string
  brand: BrandFamily                 // who wrote the shared partly row
  heb: string | null
  fams: Record<string, number>       // family -> scanned cars
  shared_numbering: boolean          // every pair of its families shares a scheme
}
interface MatchRel {
  a: string; aBrand: BrandFamily; aHeb: string | null
  b: string; bBrand: BrandFamily; bHeb: string | null
  source: string
}
interface Payload { codes: CodeRel[]; matches: MatchRel[]; computedAt: string }

const CACHE_KEY = 'catalog:cross-brand:v1'
const CACHE_TTL = 30 * 60

/** The make -> family fold, as SQL, so the grouping happens in Postgres. */
const FAMILY_SQL = `CASE
  WHEN p.make ~ '(פיג|סיטר|אופל|די ?אס|PEUGEOT|CITRO|OPEL|VAUXHALL)' THEN 'PSA'
  WHEN p.make ~ '(אמ ?ג|מ\\.ג|^MG|SAIC)' THEN 'MG'
  WHEN p.make ~ '(טויוטה|לקסוס|TOYOTA|LEXUS)' THEN 'TOYOTA'
  WHEN p.make ~ '(וולבו|וולוו|VOLVO)' THEN 'VOLVO'
  WHEN p.make ~ '(פולקס|אאודי|סיאט|סקודה|קופרה|VOLKSWAGEN|^VW|AUDI|SEAT|SKODA|CUPRA)' THEN 'VAG'
  WHEN p.make ~ '(ב ?מ ?וו|BMW|MINI)' THEN 'BMW'
  WHEN p.make ~ '(פיאט|FIAT|ALFA|LANCIA)' THEN 'FIAT'
  WHEN p.make ~ '(מיצוב|MITSUBISHI)' THEN 'MITSUBISHI'
  ELSE 'OTHER' END`

async function compute(): Promise<Payload> {
  const codesRes = await query(
    `WITH fam AS (
       SELECT pp.global_part_id, ${FAMILY_SQL} AS family, count(*)::int AS cars
         FROM partly.project_parts pp
         JOIN partly.projects p ON p.id = pp.project_id
        WHERE pp.deleted_at IS NULL
        GROUP BY 1, 2),
     multi AS (
       SELECT global_part_id FROM fam WHERE family <> 'OTHER'
        GROUP BY 1 HAVING count(*) > 1)
     SELECT gp.item_number AS code, gp.brand, nullif(gp.hebrew_description, '-') AS heb,
            json_object_agg(f.family, f.cars) AS fams
       FROM multi m
       JOIN partly.global_parts gp ON gp.id = m.global_part_id
       JOIN fam f ON f.global_part_id = m.global_part_id AND f.family <> 'OTHER'
      GROUP BY gp.item_number, gp.brand, gp.hebrew_description`,
  )
  const codes: CodeRel[] = ((codesRes?.rows ?? []) as Array<{ code: string; brand: string; heb: string | null; fams: Record<string, number> }>).map((r) => {
    const fams = r.fams as Record<string, number>
    const families = Object.keys(fams) as BrandFamily[]
    let shared = true
    for (let i = 0; i < families.length; i++)
      for (let j = i + 1; j < families.length; j++)
        if (!sharesNumbering(families[i], families[j])) shared = false
    return { code: r.code, brand: familyOf(r.brand), heb: r.heb, fams, shared_numbering: shared }
  })

  const matchRes = await query(
    `SELECT ga.item_number AS a, ga.brand AS ab, nullif(ga.hebrew_description, '-') AS ah,
            gb.item_number AS b, gb.brand AS bb, nullif(gb.hebrew_description, '-') AS bh,
            pl.source
       FROM partly.part_links pl
       JOIN partly.global_parts ga ON ga.id = pl.global_part_id_a
       JOIN partly.global_parts gb ON gb.id = pl.global_part_id_b
      WHERE pl.status = 'active' AND ga.brand <> gb.brand
      ORDER BY (pl.source = 'manual') DESC, ga.item_number`,
  )
  const matches: MatchRel[] = ((matchRes?.rows ?? []) as Array<{ a: string; ab: string; ah: string | null; b: string; bb: string; bh: string | null; source: string }>)
    .map((r) => ({
      a: r.a, aBrand: familyOf(r.ab), aHeb: r.ah,
      b: r.b, bBrand: familyOf(r.bb), bHeb: r.bh,
      source: r.source,
    }))
    // same family on both sides (Skoda–Audi) is not cross-brand for our purposes
    .filter((m: MatchRel) => m.aBrand !== m.bBrand)

  return { codes, matches, computedAt: new Date().toISOString() }
}

export async function GET(req: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(req.url)
    const kind = searchParams.get('kind') || 'all'
    const family = (searchParams.get('family') || '').toUpperCase()
    const q = (searchParams.get('q') || '').trim().toUpperCase()
    const limit = Math.min(600, Math.max(20, parseInt(searchParams.get('limit') || '200', 10) || 200))
    const fresh = searchParams.get('fresh') === '1'

    let data = fresh ? null : await getCached<Payload>(CACHE_KEY).catch(() => null)
    if (!data) {
      data = await compute()
      await setCache(CACHE_KEY, data, CACHE_TTL).catch(() => undefined)
    }

    const hit = (code: string, heb: string | null) =>
      !q || code.toUpperCase().includes(q) || (heb ?? '').toUpperCase().includes(q)

    let codes = data.codes
    if (kind === 'collisions') codes = codes.filter((c) => !c.shared_numbering)
    else if (kind === 'shared') codes = codes.filter((c) => c.shared_numbering)
    else if (kind === 'matches') codes = []
    if (family) codes = codes.filter((c) => family in c.fams)
    if (q) codes = codes.filter((c) => hit(c.code, c.heb))
    // the busiest numbers first, so a cap keeps what is most worth seeing
    codes = [...codes].sort((x, y) =>
      Object.values(y.fams).reduce((s, n) => s + n, 0) - Object.values(x.fams).reduce((s, n) => s + n, 0))

    let matches = data.matches
    if (kind === 'collisions' || kind === 'shared') matches = []
    if (family) matches = matches.filter((m) => m.aBrand === family || m.bBrand === family)
    if (q) matches = matches.filter((m) => hit(m.a, m.aHeb) || hit(m.b, m.bHeb))

    const totals = { codes: codes.length, matches: matches.length }
    // one budget for the whole graph: codes first, then matched pairs
    const codesOut = codes.slice(0, limit)
    const matchesOut = matches.slice(0, Math.max(0, Math.floor((limit - codesOut.length) / 2)))

    return NextResponse.json({
      codes: codesOut, matches: matchesOut, totals,
      truncated: codesOut.length < codes.length || matchesOut.length < matches.length,
      computedAt: data.computedAt,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'cross-brand failed' },
      { status: 500 },
    )
  }
}
