import { query } from '@/lib/db'

/**
 * Translating a Finansit/ERP code into the item_number(s) partly stores it under.
 *
 * The two catalogues do NOT agree on how a code is spelled, and the differences
 * are silent — a mismatch reads as "this part has no catalogue data", never as
 * an error. There are three of them:
 *
 *  1. MG parts carry an `MG` prefix on the Finansit side ONLY. The ERP has
 *     `MG10526735`; partly has `10526735`, brand MG. 9,931 MG items are in this
 *     shape, and every one of them looked catalogue-less to any caller that
 *     forgot to strip the prefix.
 *  2. `partly.finansit_links` holds manual mappings for anything irregular.
 *  3. Jan appends its own trailing letter to PSA codes for a variant it stocks
 *     (`1686490780J` for partly's `1686490780`). Stripping trailing letters is
 *     safe here — checked over the 604 codes it affects, all are Jan's own
 *     J/D/T/L suffixes on real PSA numbers — but the STEM IS TRIED LAST so an
 *     exact match always wins.
 *
 * Callers should preserve the returned order: it runs exact → prefix-stripped →
 * manual mapping → stem, most-specific first.
 */
export async function partlyCandidates(code: string): Promise<string[]> {
  const upper = String(code ?? '').trim().toUpperCase()
  if (!upper) return []

  const candidates = new Set<string>([upper])
  if (upper.startsWith('MG')) candidates.add(upper.slice(2))

  const manual = await query(
    `SELECT partly_item_number FROM partly.finansit_links WHERE finansit_code = $1`,
    [upper],
  ).catch(() => null)
  for (const row of manual?.rows ?? []) {
    if (row.partly_item_number) candidates.add(String(row.partly_item_number).toUpperCase())
  }

  return Array.from(candidates)
}

/** The normalised forms to match `global_parts.item_number` against, stem last. */
export function partlyMatchForms(candidates: string[]): string[] {
  const forms = new Set<string>()
  for (const c of candidates) {
    const norm = String(c ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    if (norm) forms.add(norm)
  }
  for (const c of candidates) {
    const norm = String(c ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    const stem = norm.replace(/[A-Z]+$/, '')
    if (stem && stem !== norm) forms.add(stem)
  }
  return [...forms]
}
