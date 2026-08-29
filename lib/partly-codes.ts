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

/**
 * The supersession chains Partly reads out of the manufacturer's catalog.
 *
 * ServiceBox marks a superseded line with the original code and "RP <new
 * code>"; the PSA scraper records the pair in `partly.part_supersessions`. It
 * is a SEPARATE lineage from the ERP's own `old_item_id`/`new_item_id` chain
 * (hand-maintained in Finansit) and usually reaches one step FURTHER — the
 * catalog knows a replacement long before we open an item for it. Peugeot 208
 * headlamp: the ERP has 1608206680 → 1609697280, the catalog says the current
 * number is 1685352480, and nothing in the ERP has ever heard of it.
 *
 * Never merged into `item_id_history`, which is FINAPI's ERP truth and is what
 * stock and price fold through.
 */

/** How far to follow a chain. Catalog and supplier data does contain loops. */
const MAX_CHAIN_HOPS = 5

/**
 * Catalog codes that continue the chain PAST the codes already in it.
 *
 * `known` seeds the cycle guard: pass the whole ERP chain, not just its tail.
 * The catalog edge starts at whichever code the diagram was drawn with — for
 * the 208 headlamp that is the chain HEAD (1608206680 → 1685352480) — so a walk
 * that only looked forward from the tail would find nothing. The successors are
 * still appended AFTER the tail, which is where they belong in time.
 */
export async function catalogChainAfter(known: string[]): Promise<Array<{ code: string; name: string | null }>> {
  const seen = new Set(known.map((c) => String(c ?? '').trim().toUpperCase()).filter(Boolean))
  if (seen.size === 0) return []

  const out: string[] = []
  let frontier = [...seen]

  for (let hop = 0; hop < MAX_CHAIN_HOPS && frontier.length > 0; hop++) {
    const res = await query(
      `SELECT DISTINCT new_item_number FROM partly.part_supersessions
        WHERE old_item_number = ANY($1::text[])`,
      [frontier],
    ).catch(() => null)

    const next: string[] = []
    for (const r of res?.rows ?? []) {
      const c = String((r as { new_item_number: string }).new_item_number ?? '').trim()
      if (!c || seen.has(c.toUpperCase())) continue
      seen.add(c.toUpperCase())
      next.push(c)
      out.push(c)
    }
    frontier = next
  }
  if (out.length === 0) return []

  // Name them from the catalog — these codes have no ERP row to take a name from.
  const named = await query(
    `SELECT item_number,
            CASE WHEN hebrew_description IS NOT NULL AND hebrew_description <> '-'
                 THEN hebrew_description ELSE description END AS name
       FROM partly.global_parts WHERE item_number = ANY($1::text[])`,
    [out],
  ).catch(() => null)
  const nameByCode = new Map<string, string>()
  for (const r of named?.rows ?? []) {
    const row = r as { item_number: string; name: string | null }
    if (row.name) nameByCode.set(row.item_number, row.name)
  }

  return out.map((code) => ({ code, name: nameByCode.get(code) ?? null }))
}

/**
 * A catalog-only code → the code we actually stock it under, via the chain.
 *
 * Direction-blind: a catalog code is normally the `new` end and the ERP code
 * the `old` one, but a catalog that is BEHIND the ERP puts it the other way
 * round. Returns the nearest hop that exists in `erp.items`, so a customer
 * quoting the number on the box gets the part we hold rather than a dead end.
 */
export async function erpCodeViaSupersession(code: string): Promise<string | null> {
  const start = String(code ?? '').trim()
  if (!start) return null

  const seen = new Set([start])
  let frontier = [start]

  for (let hop = 0; hop < MAX_CHAIN_HOPS && frontier.length > 0; hop++) {
    const res = await query(
      `SELECT old_item_number, new_item_number FROM partly.part_supersessions
        WHERE old_item_number = ANY($1::text[]) OR new_item_number = ANY($1::text[])`,
      [frontier],
    ).catch(() => null)

    const next: string[] = []
    for (const r of res?.rows ?? []) {
      const row = r as { old_item_number: string; new_item_number: string }
      for (const c of [row.old_item_number, row.new_item_number]) {
        const v = String(c ?? '').trim()
        if (!v || seen.has(v)) continue
        seen.add(v)
        next.push(v)
      }
    }
    if (next.length === 0) break

    // Nearest hop first: ask the ERP about this ring before going deeper. The
    // MG-prefix spelling trap applies here as everywhere else in this file.
    const hit = await query(
      `SELECT code FROM erp.items
        WHERE code = ANY($1::text[]) OR code = ANY($2::text[])
        LIMIT 1`,
      [next, next.map((c) => 'MG' + c)],
    ).catch(() => null)
    const found = (hit?.rows?.[0] as { code: string } | undefined)?.code
    if (found) return found

    frontier = next
  }

  return null
}
