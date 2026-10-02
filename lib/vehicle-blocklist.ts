/**
 * Vehicle blocklist — pure helpers shared by the /vehicle-blocklist page and its
 * proxy routes. No fetch, no env.
 *
 * A row says: VINs starting with this prefix are never scanned or imported into
 * Partly by this provider ('all' = by any provider). The data lives in Partly
 * (`/api/vehicle-blocklist`, table partly.vehicle_blocklist); Partly and the
 * nightly scan reconciler read it within a minute of a change.
 */

export const BLOCKLIST_PROVIDERS = ['all', 'psa', 'saic', 'partslink', 'vin17', 'qipei'] as const
export type BlocklistProvider = (typeof BLOCKLIST_PROVIDERS)[number]
export const SERVING_PROVIDERS = ['psa', 'saic', 'partslink', 'vin17', 'qipei'] as const
export type ServingProvider = (typeof SERVING_PROVIDERS)[number]

export const PROVIDER_LABEL: Record<BlocklistProvider, string> = {
  all: 'כל הספקים',
  psa: 'PSA',
  saic: 'SAIC / MG',
  partslink: 'PartsLink24',
  vin17: '17vin',
  qipei: 'Qipei (BYD)',
}

export interface BlocklistEntry {
  id: string
  vin_prefix: string
  provider: BlocklistProvider
  reason: string
  active: boolean
  created_by: string | null
  updated_by: string | null
  created_at: string | null
  updated_at: string | null
}

export interface BlocklistListResponse {
  entries: BlocklistEntry[]
  count: number
  /** Added by the dashboard proxy, not by Partly. */
  viewer?: { email: string | null; canEdit: boolean }
}

export interface BlocklistLogEntry {
  id?: string
  entry_id?: string
  action?: string
  before?: unknown
  after?: unknown
  by?: string | null
  at?: string | null
}

export interface BlocklistDetailResponse { entry: BlocklistEntry; log: BlocklistLogEntry[] }

export interface BlocklistVinTest {
  vin: string
  /** True when Partly could not read the table and answered from its hard-coded fallback. */
  fallback: boolean
  providers: Partial<Record<ServingProvider, BlocklistEntry | null>>
}

export const isProvider = (v: unknown): v is BlocklistProvider =>
  typeof v === 'string' && (BLOCKLIST_PROVIDERS as readonly string[]).includes(v)

// ---------------------------------------------------------------------------
// Filter

export interface BlocklistFilter {
  q?: string
  provider?: BlocklistProvider | null
  active?: boolean | null
}

export function filterEntries(rows: BlocklistEntry[], f: BlocklistFilter): BlocklistEntry[] {
  const q = (f.q ?? '').trim().toUpperCase()
  return rows.filter(r =>
    (!f.provider || r.provider === f.provider) &&
    (f.active == null || r.active === f.active) &&
    (!q || r.vin_prefix.includes(q) || r.reason.toUpperCase().includes(q) || q.startsWith(r.vin_prefix)),
  )
}

// ---------------------------------------------------------------------------
// Form

export interface BlocklistForm {
  vin_prefix: string
  provider: BlocklistProvider
  reason: string
  active: boolean
}

export const EMPTY_BLOCKLIST_FORM: BlocklistForm = { vin_prefix: '', provider: 'all', reason: '', active: true }

export function entryToForm(e: BlocklistEntry): BlocklistForm {
  return { vin_prefix: e.vin_prefix, provider: e.provider, reason: e.reason, active: e.active }
}

export const normalizePrefix = (s: string) => s.replace(/\s+/g, '').toUpperCase()

export function validateBlocklistForm(f: BlocklistForm): string[] {
  const errors: string[] = []
  const p = normalizePrefix(f.vin_prefix)
  if (!p) errors.push('קידומת VIN היא שדה חובה')
  else if (!/^[A-Z0-9]+$/.test(p)) errors.push('קידומת VIN: אותיות לטיניות וספרות בלבד')
  else if (p.length < 3 || p.length > 17) errors.push('קידומת VIN: בין 3 ל־17 תווים')
  else if (/[IOQ]/.test(p)) errors.push('קידומת VIN: האותיות I, O, Q לא קיימות ב־VIN')
  if (!isProvider(f.provider)) errors.push('ספק לא תקין')
  const r = f.reason.trim()
  if (!r) errors.push('סיבה היא שדה חובה')
  else if (r.length > 500) errors.push('סיבה: עד 500 תווים')
  return errors
}

export function formToPayload(f: BlocklistForm): Record<string, unknown> {
  return { vin_prefix: normalizePrefix(f.vin_prefix), provider: f.provider, reason: f.reason.trim(), active: f.active }
}

/** Only the fields that changed — the PATCH body. */
export function changedFields(before: BlocklistEntry, f: BlocklistForm): Record<string, unknown> {
  const next = formToPayload(f)
  const out: Record<string, unknown> = {}
  for (const k of ['vin_prefix', 'provider', 'reason', 'active'] as const) {
    if (next[k] !== before[k]) out[k] = next[k]
  }
  return out
}

/** The providers that block a VIN in a ?vin= test answer. */
export function blockingProviders(t: BlocklistVinTest): ServingProvider[] {
  return SERVING_PROVIDERS.filter(p => !!t.providers[p])
}
