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
