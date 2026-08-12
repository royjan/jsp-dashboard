import { getShipmentsFirestore } from '@/lib/firebase'
import { getCached, setCache } from '@/lib/redis-client'
import { leadToken, padNum, type MatchedSupplier, type SupplierMatcher } from '@/lib/supplier-match'

/**
 * The `suppliers` collection in the warehouse-receiving Firestore project
 * (`countainer-staging`) is the authoritative supplier registry: the container
 * app writes it, doc id == the Finansit supplier code, and `aliases` holds the
 * short tags the warehouse uses on shipment folders ("08", "11ARG", "AF").
 *
 * It matters because the dashboard's own supplier names are derived with
 * `MAX(customer_name)` over purchase documents — a lexicographic max across
 * rows whose name strings differ, which regularly picks a junk one (0000055082
 * came out as "70 נשלח אושר" instead of "AUTO FRANCE PARTS SAS 07"). Where the
 * registry knows a code, its name wins.
 *
 * Small (a dozen docs) and read-only. Never throws: with no Firebase
 * credential this degrades to an empty registry and every caller falls back to
 * its previous behaviour.
 */

export type RegistrySupplier = {
  code: string
  name: string
  aliases: string[]
  active: boolean
  currency?: string
}

export interface SupplierRegistry {
  all(): RegistrySupplier[]
  byCode(code?: string | null): RegistrySupplier | null
  /** Registry name for a code, or null when the code is unknown here. */
  name(code?: string | null): string | null
  /** Resolve a supplier code OR a shipment folder/alias tag ("08", "AF"). */
  resolve(token?: string | null): RegistrySupplier | null
  readonly size: number
}

const CACHE_KEY = 'suppliers:registry:v1'
const TTL_SECONDS = 60 * 60

async function fetchRegistry(): Promise<RegistrySupplier[]> {
  const db = await getShipmentsFirestore()
  const snap = await db.collection('suppliers').get()
  return snap.docs.map((doc) => {
    const d = doc.data() as Record<string, unknown>
    return {
      code: (d.finansitCode as string) || doc.id,
      name: (d.name as string) || doc.id,
      aliases: Array.isArray(d.aliases) ? (d.aliases as unknown[]).map(String).filter(Boolean) : [],
      active: d.active !== false,
      currency: (d.currency as string) || undefined,
    }
  })
}

/** Index the flat list — cheap enough to redo per request at this size. */
function index(rows: RegistrySupplier[]): SupplierRegistry {
  const byCode = new Map<string, RegistrySupplier>()
  const byToken = new Map<string, RegistrySupplier>()

  const addToken = (token: string | null | undefined, s: RegistrySupplier) => {
    const k = token?.trim().toLowerCase()
    if (k && !byToken.has(k)) byToken.set(k, s)
  }

  for (const s of rows) {
    byCode.set(s.code, s)
    addToken(s.code, s)
    for (const alias of s.aliases) {
      addToken(alias, s)
      // "8" and "08" are the same warehouse tag.
      addToken(padNum(alias), s)
    }
  }

  return {
    all: () => rows,
    byCode: (code) => (code ? byCode.get(code) || null : null),
    name: (code) => (code ? byCode.get(code)?.name || null : null),
    resolve(token) {
      const k = token?.trim().toLowerCase()
      if (!k) return null
      return byToken.get(k) || byToken.get(padNum(k) || '') || null
    },
    size: rows.length,
  }
}

export async function getSupplierRegistry(): Promise<SupplierRegistry> {
  try {
    const cached = await getCached<RegistrySupplier[]>(CACHE_KEY)
    if (cached) return index(cached)
  } catch {
    /* cache is best-effort */
  }

  try {
    const rows = await fetchRegistry()
    await setCache(CACHE_KEY, rows, TTL_SECONDS)
    return index(rows)
  } catch (e) {
    console.warn('[supplier-registry] unavailable:', e instanceof Error ? e.message : e)
    return index([])
  }
}

// ---------------------------------------------------------------------------
// Shipment → supplier
// ---------------------------------------------------------------------------

export type ShipmentSupplier = {
  /** Warehouse folder the shipment sits in ("08", "לובינסקי"). */
  folder: string | null
  /** Internal delivery — no supplier, and not counted as one. */
  isInternal: boolean
  /** Who an internal delivery actually came from (see internalSource). */
  internalSource: string | null
  /** Display tag for the shipment: the folder, else the name's lead token. */
  tag: string | null
  matchedSupplier: MatchedSupplier | null
}

// Every internal delivery is filed under the one folder "לובינסקי" regardless
// of who actually sent it — the real sender only appears in the free-text
// `name`, spelled inconsistently ("לוינסקי", "לובניסקי", "דוד לובינסקי",
// "מקבוצת לובינסקי"). These are the distinct senders, each with the spellings
// seen in the data; matching is on a punctuation-stripped name so a typo in
// the middle of a word still lands in the right group.
const INTERNAL_SOURCES: Array<{ label: string; match: RegExp }> = [
  { label: 'קאר איסט', match: /קאר\s*איסט/ },
  { label: "ג'אן", match: /ג['׳]?אן/ },
  // לובינסקי and its misspellings: לוב/לוו/לו + optional נ/ל + ינסקי.
  { label: 'לובינסקי', match: /לו[בו]?[נל]?[יל]?[נל]?סקי/ },
]

/**
 * Which company an internal delivery came from. Derived from the name because
 * the folder cannot distinguish them; falls back to the folder when no known
 * sender matches, so an unrecognised one still shows something.
 */
export function internalSource(name?: string | null, folder?: string | null): string | null {
  const clean = (name || '').replace(/["'׳״]/g, '').replace(/\s+/g, ' ').trim()
  for (const s of INTERNAL_SOURCES) {
    if (s.match.test(clean)) return s.label
  }
  return folder || null
}

/**
 * Both shipment routes resolve the supplier the same way, in this order:
 *   1. `supplierCode` stated on the shipment doc (registry name preferred).
 *   2. The shipment's `folder`, matched against registry codes + aliases.
 *   3. The legacy name-parsing matcher — still the only path that honours a
 *      manually-set `shipment_tag` on a supplier profile, so a user can
 *      correct a match the registry doesn't know about.
 *   4. The name's lead token against registry aliases. Last because it guesses
 *      the token, but it catches the letter tags ("AF", "11ARG") the legacy
 *      matcher's number regex structurally cannot.
 * Internal deliveries short-circuit: they are labelled, never matched.
 */
export function resolveShipmentSupplier(
  data: Record<string, unknown>,
  registry: SupplierRegistry | null,
  matcher: SupplierMatcher | null,
): ShipmentSupplier {
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

  const folder = str(data.folder)
  const isInternal = data.isInternal === true
  const name = str(data.name)
  const tag = folder || leadToken(name)

  if (isInternal) {
    // The folder says "לובינסקי" for all of them; the name says who it really was.
    const src = internalSource(name, folder)
    return { folder, isInternal, internalSource: src, tag: src || tag, matchedSupplier: null }
  }

  const base = { folder, isInternal, internalSource: null, tag }

  const code = str(data.supplierCode)
  if (code) {
    return {
      ...base,
      matchedSupplier: { code, name: registry?.name(code) || str(data.supplierName) || code },
    }
  }

  const byFolder = registry?.resolve(folder)
  if (byFolder) {
    return { ...base, matchedSupplier: { code: byFolder.code, name: byFolder.name } }
  }

  const legacy = matcher?.match(name) || null
  if (legacy) {
    return {
      ...base,
      matchedSupplier: { code: legacy.code, name: registry?.name(legacy.code) || legacy.name },
    }
  }

  const byToken = registry?.resolve(leadToken(name))
  return {
    ...base,
    matchedSupplier: byToken ? { code: byToken.code, name: byToken.name } : null,
  }
}
