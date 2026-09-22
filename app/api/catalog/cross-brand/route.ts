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
  in_erp: boolean                    // the ERP has an item for it (bare, or MG-prefixed)
  stock: number                      // on-hand quantity in the ERP mirror, 0 when none
}
interface MatchRel {
  a: string; aBrand: BrandFamily; aHeb: string | null; aInErp: boolean; aStock: number
  b: string; bBrand: BrandFamily; bHeb: string | null; bInErp: boolean; bStock: number
  source: string
}
interface Payload { codes: CodeRel[]; matches: MatchRel[]; computedAt: string }

const CACHE_KEY = 'catalog:cross-brand:v2'
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
    return { code: r.code, brand: familyOf(r.brand), heb: r.heb, fams, shared_numbering: shared, in_erp: false, stock: 0 }
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
      a: r.a, aBrand: familyOf(r.ab), aHeb: r.ah, aInErp: false, aStock: 0,
      b: r.b, bBrand: familyOf(r.bb), bHeb: r.bh, bInErp: false, bStock: 0,
      source: r.source,
    }))
    // same family on both sides (Skoda–Audi) is not cross-brand for our purposes
    .filter((m: MatchRel) => m.aBrand !== m.bBrand)

  // ── ERP presence and stock, from the nightly mirror ──
  // Partly stores MG numbers bare and the ERP files them with the MG prefix,
  // so both spellings are asked for and either counts.
  const wanted = new Set<string>()
  for (const c of codes) { wanted.add(c.code); wanted.add('MG' + c.code) }
  for (const m of matches) { wanted.add(m.a); wanted.add('MG' + m.a); wanted.add(m.b); wanted.add('MG' + m.b) }
  const erp = new Map<string, number>()   // erp code -> stock qty (0 when listed with none)
  const all = [...wanted]
  for (let i = 0; i < all.length; i += 2000) {
    const chunk = all.slice(i, i + 2000)
    const res = await query(
      `SELECT i.code, coalesce(sum(s.qty), 0)::float AS qty
         FROM erp.items i
         LEFT JOIN erp.stock s ON s.item_code = i.code
        WHERE i.code = ANY($1)
        GROUP BY i.code`,
      [chunk],
    ).catch(() => null)
    for (const r of (res?.rows ?? []) as Array<{ code: string; qty: number }>) erp.set(r.code, Number(r.qty) || 0)
  }
  const look = (code: string) => {
    const bare = erp.get(code), mg = erp.get('MG' + code)
    return { in_erp: bare !== undefined || mg !== undefined, stock: Math.max(bare ?? 0, mg ?? 0) }
  }
  for (const c of codes) Object.assign(c, look(c.code))
  for (const m of matches) {
    const a = look(m.a), b = look(m.b)
    m.aInErp = a.in_erp; m.aStock = a.stock; m.bInErp = b.in_erp; m.bStock = b.stock
  }

  return { codes, matches, computedAt: new Date().toISOString() }
}

export async function GET(req: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(req.url)
    const kind = searchParams.get('kind') || 'all'
    const family = (searchParams.get('family') || '').toUpperCase()
    // erp=in: the ERP has the item; erp=out: it does not; erp=stock: on the shelf now
    const erpFilter = searchParams.get('erp') || 'all'
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
    if (erpFilter === 'in') codes = codes.filter((c) => c.in_erp)
    else if (erpFilter === 'out') codes = codes.filter((c) => !c.in_erp)
    else if (erpFilter === 'stock') codes = codes.filter((c) => c.stock > 0)
    if (q) codes = codes.filter((c) => hit(c.code, c.heb))
    // the busiest numbers first, so a cap keeps what is most worth seeing
    codes = [...codes].sort((x, y) =>
      Object.values(y.fams).reduce((s, n) => s + n, 0) - Object.values(x.fams).reduce((s, n) => s + n, 0))

    let matches = data.matches
    if (kind === 'collisions' || kind === 'shared') matches = []
    if (family) matches = matches.filter((m) => m.aBrand === family || m.bBrand === family)
    // a matched pair "exists in the ERP" when either side does — that is the point of a match
    if (erpFilter === 'in') matches = matches.filter((m) => m.aInErp || m.bInErp)
    else if (erpFilter === 'out') matches = matches.filter((m) => !m.aInErp && !m.bInErp)
    else if (erpFilter === 'stock') matches = matches.filter((m) => m.aStock > 0 || m.bStock > 0)
    if (q) matches = matches.filter((m) => hit(m.a, m.aHeb) || hit(m.b, m.bHeb))

    const uniqueCodes = new Set<string>()
    for (const c of codes) uniqueCodes.add(c.code)
    for (const m of matches) { uniqueCodes.add(m.a); uniqueCodes.add(m.b) }
    const totals = {
      codes: codes.length,
      matches: matches.length,
      unique_codes: uniqueCodes.size,
      in_erp: codes.filter((c) => c.in_erp).length + matches.filter((m) => m.aInErp || m.bInErp).length,
      in_stock: codes.filter((c) => c.stock > 0).length + matches.filter((m) => m.aStock > 0 || m.bStock > 0).length,
    }
    // One node budget for the whole graph, shared: matched pairs get up to a
    // third of it (two nodes each) so a brand that only appears through
    // matches — Toyota — is never crowded out by the same-number codes.
    // ERP-backed pairs first: those are the ones worth a look.
    const pairBudget = Math.floor(limit / 3 / 2)
    const rankedMatches = [...matches].sort((x, y) =>
      Number(y.aInErp || y.bInErp) - Number(x.aInErp || x.bInErp) || Number(y.source === 'manual') - Number(x.source === 'manual'))
    const matchesOut = rankedMatches.slice(0, Math.min(pairBudget, rankedMatches.length))
    const codesOut = codes.slice(0, Math.max(0, limit - matchesOut.length * 2))

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
