/**
 * Brand derivation from an item code prefix (business rule from the owner):
 *   'MG…'  => MG (SAIC)   — Finansit codes carry the MG prefix; the partly
 *                            catalog stores them WITHOUT it (partly '10112700'
 *                            == finansit 'MG10112700').
 *   'SU0…' => TOYOTA (ProAce, PartsLink24 catalog)
 *   else   => PSA (Peugeot / Citroen / Opel — same code on both sides).
 */
export type Brand = 'MG' | 'TOYOTA' | 'PSA'

export function deriveBrand(code: string): Brand {
  const c = (code || '').trim().toUpperCase()
  if (c.startsWith('MG')) return 'MG'
  if (c.startsWith('SU0')) return 'TOYOTA'
  return 'PSA'
}

/**
 * Tailwind classes for a small muted-professional brand chip.
 * Matches the app's existing badge idiom (see components/ui/badge.tsx —
 * light bg + dark text, with dark: variants).
 */
export function brandChipClasses(brand: Brand | string): string {
  switch (brand) {
    case 'MG':
      return 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/30'
    case 'TOYOTA':
      return 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/15 dark:text-rose-400 dark:border-rose-500/30'
    default: // PSA
      return 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/30'
  }
}

/** Resolution hierarchy: PSA (canonical) > MG > TOYOTA. Lower = preferred. */
export const BRAND_RANK: Record<string, number> = { PSA: 0, MG: 1, TOYOTA: 2 }

/* ------------------------------------------------------------------------ */
/* Brand FAMILIES — the manufacturer group a scanned vehicle belongs to.     */
/*                                                                          */
/* `Brand` above is the ERP's three-way split, read off a code's prefix.    */
/* Partly scans more marques than the ERP stocks (Volvo, the VW group, BMW, */
/* Fiat, Mitsubishi), and each files its cars under a Hebrew `make` such as */
/* "וולבו שוודיה" or "סיאט צ'כיה". A family folds those into one label so   */
/* the item page can say "this number also appears on a VOLVO" — the case  */
/* where the same item number is NOT the same part.                         */
/* ------------------------------------------------------------------------ */

export type BrandFamily =
  | 'PSA' | 'MG' | 'TOYOTA' | 'VOLVO' | 'VAG' | 'BMW' | 'FIAT' | 'MITSUBISHI' | 'OTHER'

const FAMILY_RULES: Array<[BrandFamily, RegExp]> = [
  ['PSA', /(פיג|סיטר|אופל|די ?אס|PEUGEOT|CITRO|OPEL|VAUXHALL|^DS\b|^PSA$)/i],
  ['MG', /(אמ ?ג|מ\.ג|^MG\b|SAIC)/i],
  ['TOYOTA', /(טויוטה|לקסוס|TOYOTA|LEXUS)/i],
  ['VOLVO', /(וולבו|וולוו|VOLVO)/i],
  ['VAG', /(פולקס|אאודי|סיאט|סקודה|קופרה|VOLKSWAGEN|^VW\b|AUDI|SEAT|SKODA|CUPRA|^VAG$)/i],
  ['BMW', /(ב ?מ ?וו|BMW|MINI)/i],
  ['FIAT', /(פיאט|FIAT|ALFA|LANCIA)/i],
  ['MITSUBISHI', /(מיצוב|MITSUBISHI)/i],
]

/** Family of a Partly `projects.make` (Hebrew, often with a country suffix) or a `global_parts.brand`. */
export function familyOf(makeOrBrand: string | null | undefined): BrandFamily {
  const s = String(makeOrBrand ?? '').trim()
  if (!s) return 'OTHER'
  for (const [family, re] of FAMILY_RULES) if (re.test(s)) return family
  return 'OTHER'
}

/** The families the ERP has its own item numbers for; everything else is catalogue-only. */
export const ERP_FAMILIES: ReadonlySet<BrandFamily> = new Set<BrandFamily>(['PSA', 'MG', 'TOYOTA'])

/**
 * Brand pairs that print the SAME number for the SAME part as a rule:
 * Fiat/PSA share Sevel's van parts and bulbs; Opel's GM-era cars and MG's
 * SAIC-GM engines share GM's 8-digit numbers (183 of 188 shared codes matched
 * drawing-for-drawing on 2026-09-21, 5 did not). Everywhere else a shared
 * number is a coincidence: Volvo's legacy 6-digit codes collide with PSA's.
 */
const SHARED_NUMBERING: ReadonlySet<string> = new Set(['FIAT|PSA', 'MG|PSA'])
export function sharesNumbering(a: BrandFamily, b: BrandFamily): boolean {
  return SHARED_NUMBERING.has([a, b].sort().join('|'))
}

export const FAMILY_LABEL_HE: Record<BrandFamily, string> = {
  PSA: 'PSA', MG: 'MG', TOYOTA: 'טויוטה', VOLVO: 'וולוו', VAG: 'קבוצת VW', BMW: 'BMW',
  FIAT: 'פיאט', MITSUBISHI: 'מיצובישי', OTHER: 'אחר',
}

/** URL slug for /items/{brand}/{code}; `familyFromSlug` is its inverse and rejects unknowns. */
export function familySlug(f: BrandFamily): string { return f.toLowerCase() }
export function familyFromSlug(slug: string | null | undefined): BrandFamily | null {
  const up = String(slug ?? '').trim().toUpperCase()
  return (['PSA', 'MG', 'TOYOTA', 'VOLVO', 'VAG', 'BMW', 'FIAT', 'MITSUBISHI'] as BrandFamily[])
    .find((f) => f === up) ?? null
}

/** Chip classes for a family; the three ERP brands keep their existing colours. */
export function familyChipClasses(f: BrandFamily | string): string {
  switch (f) {
    case 'MG': case 'TOYOTA': case 'PSA':
      return brandChipClasses(f)
    case 'VOLVO':
      return 'bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-500/15 dark:text-sky-400 dark:border-sky-500/30'
    case 'FIAT':
      return 'bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-500/15 dark:text-orange-400 dark:border-orange-500/30'
    case 'VAG':
      return 'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-500/15 dark:text-slate-300 dark:border-slate-500/30'
    case 'BMW':
      return 'bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-500/15 dark:text-violet-400 dark:border-violet-500/30'
    case 'MITSUBISHI':
      return 'bg-red-50 text-red-700 border border-red-200 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/30'
    default:
      return 'bg-muted text-muted-foreground border border-border'
  }
}
