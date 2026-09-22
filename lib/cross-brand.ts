import { query } from '@/lib/db'
import { getCached, setCache } from '@/lib/redis-client'
import { familyOf, sharesNumbering, type BrandFamily } from '@/lib/brand'

/**
 * Every cross-brand relation in the catalogue, computed once and kept in Redis.
 *
 * Two kinds, one graph:
 *  · `codes`   — item numbers printed by more than one brand family's cars.
 *                Either a shared numbering scheme (Fiat with PSA, MG with
 *                Opel — usually the same part) or a collision (Volvo with PSA —
 *                a different part under the same number).
 *  · `matches` — partly.part_links pairs whose two sides are different brands:
 *                the same part under two numbers (PSA 8335VP = Toyota SU001A2053).
 *
 * The same-number half groups every project_parts row by (part, family) and
 * the rest joins the ERP mirror, so the whole answer takes seconds. It is
 * written to Redis for 36 hours and rebuilt every night by the
 * /api/cron/cross-brand-refresh route (jan-cross-brand-refresh.timer on
 * jan-box), so a page load reads one key. A miss — first deploy, Redis
 * flushed — still computes on demand and writes the key.
 *
 * Demo vehicles count: a trial scan of a Volvo is still Volvo's catalog
 * printing the number.
 */

export interface CodeRel {
  code: string
  brand: BrandFamily                 // who wrote the shared partly row
  heb: string | null
  fams: Record<string, number>       // family -> scanned cars
  shared_numbering: boolean          // every pair of its families shares a scheme
  in_erp: boolean                    // the ERP has an item for it (bare, or MG-prefixed)
  stock: number                      // on-hand quantity in the ERP mirror, 0 when none
}
export interface MatchRel {
  a: string; aBrand: BrandFamily; aHeb: string | null; aInErp: boolean; aStock: number; aCars: number
  b: string; bBrand: BrandFamily; bHeb: string | null; bInErp: boolean; bStock: number; bCars: number
  source: string
}
/** Per brand family: every part the catalog holds, and how many of them are cross-brand. */
export interface BrandTotals { parts: number; cross: number }
export interface CrossBrandData { codes: CodeRel[]; matches: MatchRel[]; brandTotals: Record<string, BrandTotals>; computedAt: string }

export const CROSS_BRAND_CACHE_KEY = 'catalog:cross-brand:v4'
/** Long enough to outlive a missed night; the nightly refresh renews it. */
export const CROSS_BRAND_TTL = 36 * 60 * 60

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

export async function computeCrossBrand(): Promise<CrossBrandData> {
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
      a: r.a, aBrand: familyOf(r.ab), aHeb: r.ah, aInErp: false, aStock: 0, aCars: 0,
      b: r.b, bBrand: familyOf(r.bb), bHeb: r.bh, bInErp: false, bStock: 0, bCars: 0,
      source: r.source,
    }))
    // same family on both sides (Skoda–Audi) is not cross-brand for our purposes
    .filter((m: MatchRel) => m.aBrand !== m.bBrand)

  // ── how many scanned cars carry each matched code: the edge width on the graph ──
  const matchCodes = [...new Set(matches.flatMap((m) => [m.a, m.b]))]
  const cars = new Map<string, number>()
  for (let i = 0; i < matchCodes.length; i += 2000) {
    const chunk = matchCodes.slice(i, i + 2000)
    const res = await query(
      `SELECT gp.item_number AS code, count(DISTINCT p.id)::int AS cars
         FROM partly.global_parts gp
         JOIN partly.project_parts pp ON pp.global_part_id = gp.id AND pp.deleted_at IS NULL
         JOIN partly.projects p ON p.id = pp.project_id
        WHERE gp.item_number = ANY($1)
        GROUP BY gp.item_number`,
      [chunk],
    ).catch(() => null)
    for (const r of (res?.rows ?? []) as Array<{ code: string; cars: number }>) cars.set(r.code, Number(r.cars) || 0)
  }
  for (const m of matches) { m.aCars = cars.get(m.a) ?? 0; m.bCars = cars.get(m.b) ?? 0 }

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

  // ── brand totals: the whole catalog per family, so the rest of the parts
  // are present on the graph as a number on each brand's disc ──
  const brandTotals: Record<string, BrandTotals> = {}
  const totRes = await query(`SELECT brand, count(*)::int AS n FROM partly.global_parts GROUP BY brand`).catch(() => null)
  for (const r of (totRes?.rows ?? []) as Array<{ brand: string; n: number }>) {
    const f = familyOf(r.brand)
    const t = (brandTotals[f] ??= { parts: 0, cross: 0 })
    t.parts += Number(r.n) || 0
  }
  const crossBy = new Map<string, Set<string>>()
  const mark = (f: string, code: string) => { const s = crossBy.get(f) ?? new Set(); s.add(code); crossBy.set(f, s) }
  for (const c of codes) for (const f of Object.keys(c.fams)) mark(f, c.code)
  for (const m of matches) { mark(m.aBrand, m.a); mark(m.bBrand, m.b) }
  for (const [f, s] of crossBy) (brandTotals[f] ??= { parts: 0, cross: 0 }).cross = s.size

  return { codes, matches, brandTotals, computedAt: new Date().toISOString() }
}

/** Recompute and write the Redis entry; what the nightly cron calls. */
export async function refreshCrossBrand(): Promise<CrossBrandData> {
  const data = await computeCrossBrand()
  await setCache(CROSS_BRAND_CACHE_KEY, data, CROSS_BRAND_TTL).catch(() => undefined)
  return data
}

/** The cached answer, computing (and caching) on a miss. */
export async function loadCrossBrand(fresh = false): Promise<CrossBrandData> {
  if (!fresh) {
    const hit = await getCached<CrossBrandData>(CROSS_BRAND_CACHE_KEY).catch(() => null)
    if (hit) return hit
  }
  return refreshCrossBrand()
}
