import { query } from '@/lib/db'

/**
 * Scan coverage: how much of Israel's ACTIVE fleet has a scanned parts catalogue
 * in Partly, and how much of that has prices.
 *
 * Sources
 *  - Active cars per model/year: data.gov.il resource 5e87a7a1 (mispar_rechavim_pailim).
 *    NOT public.car_records — that table keeps scrapped cars and ~1.9M rows with no
 *    make/model, which overstated the fleet by ~1M.
 *  - Importer per model/year: data.gov.il resource 39f455bf (shem_yevuan).
 *  - Scanned models: partly.projects joined to car_records by VIN -> (make, degem_nm).
 *  - Prices: a part is priced when partly.retail_prices (importer lists) has it, or
 *    the ERP sells it (erp.items, incl. the MG-prefixed twin) — Jan's own prices.
 *
 * Matching is on (first word of the manufacturer, degem_nm). The full manufacturer
 * string differs between datasets ("קיה קוריאה" vs "קיה ד. קוריאה"), and matching on
 * it silently dropped Kia from 55% to 12%.
 */

const GOV = 'https://data.gov.il/api/3/action/datastore_search'
const ACTIVE_RES = '5e87a7a1-2f6f-41c1-8aec-7216d52a6cf6'
const IMPORTER_RES = '39f455bf-6db0-4926-859d-017f34eacbcb'

/** Brands priced from the ERP (Jan stocks them), not from an importer list. */
const JAN_BRANDS = new Set(["פיג'ו", 'סיטרואן', 'אופל', 'די אס', 'מ.ג'])
/** Brand (gov.il `tozar`) -> the importer price list Partly holds for it. */
const RETAIL_BRANDS: Record<string, string> = {
  'טויוטה': 'טויוטה (יוניון)', 'לקסוס': 'טויוטה (יוניון)', 'יונדאי': 'יונדאי', 'קיה': 'קיה',
  'רנו': 'רנו (קרסו)', "דאצ'יה": 'רנו (קרסו)', 'דאציה': 'רנו (קרסו)', 'וולבו': 'וולבו',
  'בי ווי די': 'BYD', "ג'אקו": "ג'אקו", 'גילי': 'גילי', 'זיקר': 'זיקר', 'מיצובישי': 'מיצובישי',
  'טסלה': 'טסלה', "צ'רי": "צ'רי (פריסבי)", 'ב מ וו': 'ב.מ.וו',
}

export interface CoveragePayload {
  /** [private 1|0, importer, brand, manufacturer, tradeName, degem, year, activeCars, scans, pricedPct (-1 = no scan)] */
  rows: Array<[number, number, number, number, number, string, number, number, number, number]>
  importers: string[]
  brands: string[]
  manufacturers: string[]
  tradeNames: string[]
  /** brand -> price source label ('' = none) */
  priceSource: Record<string, string>
  scans: number
  asOf: string
}

interface ActiveRec {
  sug_degem: string; tozeret_cd: number; tozeret_nm: string; tozar: string
  degem_cd: number; degem_nm: string; shnat_yitzur: number; mispar_rechavim_pailim: number; kinuy_mishari: string
}
interface ImporterRec { shem_yevuan: string; tozeret_cd: number; degem_cd: number; shnat_yitzur: number }

async function govAll<T>(resource: string, fields: string): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; ) {
    const url = `${GOV}?resource_id=${resource}&limit=32000&offset=${offset}&fields=${fields}`
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new Error(`data.gov.il ${resource} -> HTTP ${res.status}`)
    const { result } = (await res.json()) as { result: { records: T[]; total: number } }
    out.push(...result.records)
    offset += result.records.length
    if (!result.records.length || offset >= result.total) return out
  }
}

const quote = (s: string) => (s || '').replace(/׳/g, "'").trim()
/** Join key between gov.il and car_records: first word of the manufacturer + model code. */
export const modelKey = (manufacturer: string, degem: string) =>
  `${quote(manufacturer).split(/[\s-]+/)[0]}|${(degem || '').trim()}`

/** Importers never shown by name; their cars still count, under "לא ידוע". */
const HIDDEN_IMPORTERS = new Set(['אמיל אלימלך'])

/** "כלמוביל יונדאי" / "כלמוביל בע"מ" -> "כלמוביל"; strips company suffixes. */
export function normImporter(raw: string | null | undefined): string {
  let s = (raw || 'לא ידוע').replace(/''/g, '"').replace(/\s+/g, ' ').trim()
  s = s.replace(/\s*(בע"מ|בע"|בעמ)\s*$/, '').replace(/^[\s.-]+|[\s.-]+$/g, '')
  if (HIDDEN_IMPORTERS.has(s)) return 'לא ידוע'
  const groups: Array<[string, string]> = [
    ['כלמוביל', 'כלמוביל'], ["צ'מפיון", "צ'מפיון מוטורס"], ['יוניון מוטורס', 'יוניון מוטורס'],
    ['יוניברסל', 'יוניברסל מוטורס'], ['מאיר', 'מאיר'], ['דלק מוטורס', 'דלק מוטורס'],
    ['טל - קאר', 'טל-קאר'], ['טל-קאר', 'טל-קאר'],
  ]
  for (const [p, v] of groups) if (s.startsWith(p)) return v
  return s
}

async function scannedModels(): Promise<Map<string, { scans: number; parts: number; priced: number }>> {
  // Set-based on purpose: one distinct (project, part number) pass, then a single hash
  // join against the price sources. A per-row EXISTS over ~1.9M project_parts took minutes.
  const { rows } = await query(`
    WITH pn AS (
      SELECT DISTINCT pp.project_id, upper(regexp_replace(gp.item_number, '[^0-9A-Za-z]', '', 'g')) AS n
      FROM partly.project_parts pp
      JOIN partly.global_parts gp ON gp.id = pp.global_part_id
      WHERE pp.deleted_at IS NULL
    ),
    priced AS (
      SELECT part_number_norm AS n FROM partly.retail_prices
      UNION
      SELECT upper(regexp_replace(code, '[^0-9A-Za-z]', '', 'g')) FROM erp.items
      UNION
      SELECT upper(regexp_replace(substr(code, 3), '[^0-9A-Za-z]', '', 'g')) FROM erp.items WHERE code LIKE 'MG%'
    ),
    per AS (
      SELECT pn.project_id, count(*) AS parts, count(priced.n) AS priced
      FROM pn LEFT JOIN priced ON priced.n = pn.n
      GROUP BY pn.project_id
    )
    SELECT cr.country_brand AS make, cr.model_name AS degem,
           count(*)::int AS scans, sum(per.parts)::int AS parts, sum(per.priced)::int AS priced
    FROM partly.projects p
    JOIN per ON per.project_id = p.id
    JOIN public.car_records cr ON cr.vin = upper(trim(p.vin))
    GROUP BY 1, 2`)
  const out = new Map<string, { scans: number; parts: number; priced: number }>()
  for (const r of rows as Array<{ make: string; degem: string; scans: number; parts: number; priced: number }>) {
    const k = modelKey(r.make, r.degem)
    const x = out.get(k) ?? { scans: 0, parts: 0, priced: 0 }
    x.scans += r.scans; x.parts += r.parts; x.priced += r.priced
    out.set(k, x)
  }
  return out
}

export async function loadScanCoverage(): Promise<CoveragePayload> {
  const [active, importers, scanned, scanCount] = await Promise.all([
    govAll<ActiveRec>(ACTIVE_RES, 'sug_degem,tozeret_cd,tozeret_nm,tozar,degem_cd,degem_nm,shnat_yitzur,mispar_rechavim_pailim,kinuy_mishari'),
    govAll<ImporterRec>(IMPORTER_RES, 'shem_yevuan,tozeret_cd,degem_cd,shnat_yitzur'),
    scannedModels(),
    query('SELECT count(*)::int AS n FROM partly.projects').then(r => (r.rows[0] as { n: number }).n),
  ])
  const importerOf = new Map<string, string>()
  for (const r of importers) importerOf.set(`${r.tozeret_cd}|${r.degem_cd}|${r.shnat_yitzur}`, r.shem_yevuan)

  const dicts = { importers: [] as string[], brands: [] as string[], manufacturers: [] as string[], tradeNames: [] as string[] }
  const idx = { importers: new Map<string, number>(), brands: new Map<string, number>(), manufacturers: new Map<string, number>(), tradeNames: new Map<string, number>() }
  const id = (k: keyof typeof dicts, v: string) => {
    let i = idx[k].get(v)
    if (i === undefined) { i = dicts[k].length; dicts[k].push(v); idx[k].set(v, i) }
    return i
  }

  const rows: CoveragePayload['rows'] = []
  for (const r of active) {
    const n = r.mispar_rechavim_pailim || 0
    if (n <= 0) continue
    const s = scanned.get(modelKey(r.tozeret_nm, r.degem_nm))
    rows.push([
      r.sug_degem === 'P' ? 1 : 0,
      id('importers', normImporter(importerOf.get(`${r.tozeret_cd}|${r.degem_cd}|${r.shnat_yitzur}`))),
      id('brands', quote(r.tozar)),
      id('manufacturers', quote(r.tozeret_nm)),
      id('tradeNames', (r.kinuy_mishari || '').trim()),
      (r.degem_nm || '').trim(),
      r.shnat_yitzur,
      n,
      s?.scans ?? 0,
      s && s.parts ? Math.round((100 * s.priced) / s.parts) : -1,
    ])
  }
  const priceSource: Record<string, string> = {}
  for (const b of dicts.brands) priceSource[b] = JAN_BRANDS.has(b) ? 'ג׳אן (ERP)' : RETAIL_BRANDS[b] ?? ''

  return { rows, ...dicts, priceSource, scans: scanCount, asOf: new Date().toISOString() }
}
