/**
 * Vehicle twins — pure helpers shared by the /vehicle-twins page and its
 * proxy routes. No fetch, no env: values in, values out, so it is testable.
 *
 * A "twin" says: this Israeli-market car (brand/model/years/powertrain) is
 * answered from another catalogue's car — either the same vehicle under a
 * different badge ('rebadge') or one that shares a platform ('platform').
 * The data lives in Partly (`/api/vehicle-twins`); Diego reads it within a
 * minute of a change.
 */

export const RELATIONS = ['rebadge', 'platform'] as const
export type Relation = (typeof RELATIONS)[number]

export const CONFIDENCES = ['high', 'medium', 'low'] as const
export type Confidence = (typeof CONFIDENCES)[number]

export const POWERTRAINS = ['petrol', 'diesel', 'HEV', 'PHEV', 'EV', 'LPG'] as const
export type Powertrain = (typeof POWERTRAINS)[number]

export const RELATION_LABEL: Record<Relation, string> = {
  rebadge: 'אותו רכב',
  platform: 'פלטפורמה משותפת',
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'גבוהה',
  medium: 'בינונית',
  low: 'נמוכה',
}

export const POWERTRAIN_LABEL: Record<Powertrain, string> = {
  petrol: 'בנזין',
  diesel: 'דיזל',
  HEV: 'היברידי',
  PHEV: 'פלאג-אין',
  EV: 'חשמלי',
  LPG: 'גז',
}

export interface VehicleTwin {
  id: number | string
  market: string | null
  brand: string
  model: string
  model_codes: string[] | string | null
  vin_prefixes: string[] | string | null
  vin_pattern: string | null
  year_from: number | null
  year_to: number | null
  powertrain: string | null
  twin_brand: string
  twin_model: string
  twin_catalogue: string | null
  twin_catalogue_ref: string | null
  twin_vin_prefixes: string[] | string | null
  twin_project_id: string | number | null
  relation: Relation
  overlap_pct: number | string | null
  overlap_detail: unknown
  source: string
  confidence: Confidence | null
  notes: string | null
  created_by: string | null
  updated_by: string | null
  created_at: string | null
  updated_at: string | null
}

export interface TwinListResponse {
  twins: VehicleTwin[]
  count: number
  /** Added by the dashboard proxy, not by Partly. */
  viewer?: { email: string | null; canEdit: boolean }
}

export interface TwinLookupResponse {
  query: Record<string, unknown>
  subject: Record<string, unknown> | null
  twin: VehicleTwin | null
  matched_by: string | null
  project: Record<string, unknown> | null
  alternatives: VehicleTwin[]
}

export interface TwinLogEntry {
  id?: number | string
  action?: string
  actor?: string | null
  changed_by?: string | null
  created_at?: string | null
  at?: string | null
  before?: unknown
  after?: unknown
  diff?: unknown
  [key: string]: unknown
}

export interface TwinDetailResponse { twin: VehicleTwin; log: TwinLogEntry[] }

export interface MeasureResponse {
  twin: VehicleTwin
  overlap: Record<string, unknown> | null
  decision: unknown
}

// ---------------------------------------------------------------------------
// Admin gate

/** Who may write twins when DASHBOARD_ADMIN_EMAILS is not set. Mirrors Partly's list. */
export const DEFAULT_TWIN_ADMINS = ['roy@jan.co.il', 'avi@jan.co.il']

export function parseAdminList(raw: string | undefined | null): string[] {
  const list = (raw ?? '').split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
  return list.length ? list : DEFAULT_TWIN_ADMINS
}

export function isTwinAdmin(email: string | null | undefined, admins: string[]): boolean {
  if (!email) return false
  return admins.includes(email.trim().toLowerCase())
}

// ---------------------------------------------------------------------------
// Display

export function listOf(v: string[] | string | null | undefined): string[] {
  if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
  return []
}

/** "2016–2023", "2016+", "–2019", or "" when neither end is known. */
export function formatYears(from: number | null | undefined, to: number | null | undefined): string {
  const f = from ?? null
  const t = to ?? null
  if (f == null && t == null) return ''
  if (f != null && t != null) return f === t ? String(f) : `${f}–${t}`
  if (f != null) return `${f}+`
  return `–${t}`
}

/** 0.87 or 87 or "87.0" → 87. null when unknown. */
export function overlapPercent(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  const pct = n <= 1 && n > 0 ? n * 100 : n
  return Math.round(pct * 10) / 10
}

// ---------------------------------------------------------------------------
// Filtering

export interface TwinFilter {
  q?: string
  brand?: string | null
  relation?: Relation | null
  confidence?: Confidence | null
}

export function filterTwins(rows: VehicleTwin[], f: TwinFilter): VehicleTwin[] {
  const q = (f.q ?? '').trim().toLowerCase()
  return rows.filter(r => {
    if (f.brand && r.brand.toLowerCase() !== f.brand.toLowerCase()) return false
    if (f.relation && r.relation !== f.relation) return false
    if (f.confidence && r.confidence !== f.confidence) return false
    if (!q) return true
    const hay = [
      r.brand, r.model, r.twin_brand, r.twin_model, r.twin_catalogue, r.twin_catalogue_ref,
      r.source, r.notes, r.powertrain, r.vin_pattern,
      ...listOf(r.model_codes), ...listOf(r.vin_prefixes), ...listOf(r.twin_vin_prefixes),
    ].filter(Boolean).join(' ').toLowerCase()
    return hay.includes(q)
  })
}

export function distinctBrands(rows: VehicleTwin[]): string[] {
  return [...new Set(rows.map(r => r.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

// ---------------------------------------------------------------------------
// Form <-> payload

/** Every editable field as a string, the way an <input> holds it. */
export interface TwinForm {
  market: string
  brand: string
  model: string
  model_codes: string
  vin_prefixes: string
  vin_pattern: string
  year_from: string
  year_to: string
  powertrain: string
  twin_brand: string
  twin_model: string
  twin_catalogue: string
  twin_catalogue_ref: string
  twin_vin_prefixes: string
  twin_project_id: string
  relation: string
  source: string
  confidence: string
  notes: string
}

export const EMPTY_FORM: TwinForm = {
  market: 'IL', brand: '', model: '', model_codes: '', vin_prefixes: '', vin_pattern: '',
  year_from: '', year_to: '', powertrain: '', twin_brand: '', twin_model: '', twin_catalogue: '',
  twin_catalogue_ref: '', twin_vin_prefixes: '', twin_project_id: '', relation: 'rebadge',
  source: '', confidence: 'medium', notes: '',
}

export function twinToForm(t: VehicleTwin): TwinForm {
  const s = (v: unknown) => (v == null ? '' : String(v))
  return {
    market: s(t.market),
    brand: s(t.brand),
    model: s(t.model),
    model_codes: listOf(t.model_codes).join(', '),
    vin_prefixes: listOf(t.vin_prefixes).join(', '),
    vin_pattern: s(t.vin_pattern),
    year_from: s(t.year_from),
    year_to: s(t.year_to),
    powertrain: s(t.powertrain),
    twin_brand: s(t.twin_brand),
    twin_model: s(t.twin_model),
    twin_catalogue: s(t.twin_catalogue),
    twin_catalogue_ref: s(t.twin_catalogue_ref),
    twin_vin_prefixes: listOf(t.twin_vin_prefixes).join(', '),
    twin_project_id: s(t.twin_project_id),
    relation: s(t.relation) || 'rebadge',
    source: s(t.source),
    confidence: s(t.confidence),
    notes: s(t.notes),
  }
}

const LIST_FIELDS = new Set<keyof TwinForm>(['model_codes', 'vin_prefixes', 'twin_vin_prefixes'])
const INT_FIELDS = new Set<keyof TwinForm>(['year_from', 'year_to'])

/**
 * The JSON body for POST/PUT. Blank optional fields become null (so a PUT
 * clears them), comma lists become arrays, years become integers. Values that
 * do not parse are passed through as-is so Partly's own validation names them.
 */
export function formToPayload(f: TwinForm): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, raw] of Object.entries(f) as Array<[keyof TwinForm, string]>) {
    const v = raw.trim()
    if (LIST_FIELDS.has(k)) {
      out[k] = v ? v.split(/[,\s]+/).map(s => s.trim()).filter(Boolean) : []
    } else if (INT_FIELDS.has(k)) {
      out[k] = v === '' ? null : /^\d+$/.test(v) ? Number(v) : v
    } else {
      out[k] = v === '' ? null : v
    }
  }
  return out
}

export const REQUIRED_FIELDS: Array<keyof TwinForm> = ['brand', 'model', 'twin_brand', 'twin_model', 'relation', 'source']

/** Client-side pre-check, in Hebrew. Partly remains the authority. */
export function validateForm(f: TwinForm): string[] {
  const errs: string[] = []
  const label: Partial<Record<keyof TwinForm, string>> = {
    brand: 'יצרן', model: 'דגם', twin_brand: 'יצרן תאום', twin_model: 'דגם תאום', relation: 'סוג קשר', source: 'מקור',
  }
  for (const k of REQUIRED_FIELDS) if (!f[k].trim()) errs.push(`חסר שדה חובה: ${label[k]}`)
  if (f.relation && !(RELATIONS as readonly string[]).includes(f.relation)) errs.push('סוג קשר לא חוקי')
  if (f.powertrain && !(POWERTRAINS as readonly string[]).includes(f.powertrain)) errs.push('הנעה לא חוקית')
  if (f.confidence && !(CONFIDENCES as readonly string[]).includes(f.confidence)) errs.push('רמת ביטחון לא חוקית')
  for (const k of ['year_from', 'year_to'] as const) {
    const v = f[k].trim()
    if (v && (!/^\d{4}$/.test(v) || Number(v) < 1980 || Number(v) > 2100)) errs.push(`שנה לא חוקית: ${v}`)
  }
  if (/^\d{4}$/.test(f.year_from) && /^\d{4}$/.test(f.year_to) && Number(f.year_from) > Number(f.year_to)) {
    errs.push('שנת התחלה אחרי שנת סיום')
  }
  return errs
}

/**
 * Turn a Partly error body into lines a person can read. Partly answers
 * 400 {errors[]}, 409/404 {error}, 422 {missing}; any of them may be strings
 * or objects with a message/field.
 */
export function apiErrorLines(status: number, body: unknown): string[] {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const toText = (e: unknown): string => {
    if (typeof e === 'string') return e
    if (e && typeof e === 'object') {
      const o = e as Record<string, unknown>
      const msg = o.message ?? o.error ?? o.msg
      const field = o.field ?? o.path ?? o.key
      if (msg && field) return `${String(field)}: ${String(msg)}`
      if (msg) return String(msg)
      return JSON.stringify(e)
    }
    return String(e)
  }
  const lines: string[] = []
  if (Array.isArray(b.errors)) lines.push(...b.errors.map(toText))
  if (Array.isArray(b.missing)) lines.push(`חסרים פרויקטים סרוקים: ${b.missing.map(toText).join(', ')}`)
  else if (b.missing) lines.push(`חסר: ${toText(b.missing)}`)
  if (!lines.length && b.error) lines.push(toText(b.error))
  if (!lines.length && b.message) lines.push(toText(b.message))
  const prefix: Record<number, string> = {
    400: 'שגיאת אימות', 401: 'מפתח API שגוי', 403: 'אין הרשאת עריכה', 404: 'הרשומה לא נמצאה',
    409: 'כבר קיימת רשומה עם אותו מפתח', 422: 'אין מספיק נתונים למדידה', 502: 'Partly לא זמין',
  }
  if (!lines.length) lines.push(prefix[status] ?? `שגיאה ${status}`)
  else if (prefix[status] && status !== 400) lines.unshift(prefix[status])
  return lines
}
