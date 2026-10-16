import { NextRequest } from 'next/server'
import { verifyJanSession, JAN_SESSION_COOKIE } from '@/lib/jan-sso'

/**
 * Periodic-service kits for the Diego v5 "טיפול תקופתי" agent (2026-10-16): public.kits / kit_items / kit_products
 * in the fleet database (claude-work/suppliers-v5/service/work/ops/kits*.sql).
 *
 *   public.kits          kind='service' rows: one per fuel type (and optionally per make - a make-specific kit wins)
 *   public.kit_items     what a service holds, each with ITS OWN interval: the service at N km is every item with
 *                        N % every_km = 0 (N rounded to the kit's smallest interval). basic = in the "no km" service.
 *   public.kit_products  fluids are on no drawing, so they are Jan item codes by grade + pack size
 *
 * ONE LIST FOR EVERY BOT (owner, 2026-10-16): what a service holds is shop knowledge, not a bot setting.
 * Every write fires NOTIFY kits_changed (ops/kits_notify.sql) and the service peer re-reads on its next turn.
 * The old keyword kits (kind='bundle', jsp-chat-js /admin/kits) are never listed or touched here.
 */

/** false = refuse; otherwise who is asking ('' while auth is off). Same rule as /api/bots. */
export async function whoIs(req: NextRequest): Promise<false | string> {
  const configured = !!(process.env.JAN_AUTH_JWT_SECRET || process.env.JWT_SECRET || process.env.AUTH_SECRET)
  if (!configured) return ''
  const claims = await verifyJanSession(req.cookies.get(JAN_SESSION_COOKIE)?.value)
  return claims ? (claims.email || 'signed-in user') : false
}

/** car_records.fuel_type values, exactly as the peer compares them. */
export const FUEL_TYPES = ['בנזין', 'דיזל', 'חשמל', 'חשמל/בנזין', 'חשמל/דיזל', 'גפמ"'] as const
export const FLUIDS = ['engine_oil', 'brake_fluid', 'coolant'] as const
export const QTY_FROM = ['cylinders', 'oil_litres', 'coolant_litres'] as const
export const NEEDS = ['timing_belt', 'spark_plugs', 'fuel_filter'] as const
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const opt = (v: unknown, max: number) => str(v, max) || null
const int = (v: unknown, lo: number, hi: number, dflt: number | null) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && v !== '' && v !== null && v !== undefined ? Math.max(lo, Math.min(hi, n)) : dflt
}
const list = (v: unknown, max = 20) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\n]/) : [])
    .map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, max)
const oneOf = <T extends string>(v: unknown, of: readonly T[]): T | null => (of.includes(v as T) ? (v as T) : null)

export interface KitIn { name: string; fuel_types: string[] | null; makes: string[] | null; priority: number; is_active: boolean }
export function kitIn(b: Record<string, unknown>): KitIn | string {
  const name = str(b.name, 80)
  if (!name) return 'חסר שם'
  const fuels = list(b.fuel_types).filter((f) => (FUEL_TYPES as readonly string[]).includes(f))
  const makes = list(b.makes).map((m) => m.toUpperCase())
  return { name, fuel_types: fuels.length ? fuels : null, makes: makes.length ? makes : null,
           priority: int(b.priority, 0, 1000, 100)!, is_active: b.is_active !== false }
}

export interface ItemIn {
  sort: number; part_en: string; part_he: string; match_he: string[] | null; source: 'catalog' | 'fluid'
  fluid: string | null; qty: number; unit: string; qty_from: string | null; every_km: number
  every_months: number | null; needs: string | null; basic: boolean; optional: boolean; note_he: string | null
}
export function itemIn(b: Record<string, unknown>): ItemIn | string {
  const part_he = str(b.part_he, 80), part_en = str(b.part_en, 80)
  if (!part_he || !part_en) return 'חסר שם החלק בעברית או מונח החיפוש באנגלית'
  const every_km = int(b.every_km, 1000, 600000, null)
  if (!every_km) return 'מרווח ק"מ חייב להיות בין 1,000 ל-600,000'
  const source = b.source === 'fluid' ? 'fluid' : 'catalog'
  const fluid = source === 'fluid' ? oneOf(b.fluid, FLUIDS) : null
  if (source === 'fluid' && !fluid) return 'שורת נוזל צריכה סוג נוזל'
  const qty = Number(b.qty)
  const match = list(b.match_he)
  return {
    sort: int(b.sort, 0, 10000, 100)!, part_en, part_he, match_he: match.length ? match : null, source, fluid,
    qty: Number.isFinite(qty) && qty > 0 ? Math.min(qty, 100) : 1, unit: b.unit === 'L' ? 'L' : 'pcs',
    qty_from: oneOf(b.qty_from, QTY_FROM), every_km, every_months: int(b.every_months, 1, 240, null),
    needs: oneOf(b.needs, NEEDS), basic: b.basic === true, optional: b.optional === true, note_he: opt(b.note_he, 200),
  }
}

export interface ProductIn { fluid: string; grade: string; pack_l: number; item_code: string; makes: string[] | null; sort: number; note: string | null }
export function productIn(b: Record<string, unknown>): ProductIn | string {
  const fluid = oneOf(b.fluid, FLUIDS)
  if (!fluid) return 'חסר סוג נוזל'
  const grade = str(b.grade, 30).toUpperCase().replace(/\s*W\s*-?\s*/, 'W-').replace(/^STANDARD$/, 'standard')
  if (!grade) return 'חסרה דרגה'
  const pack = Number(b.pack_l)
  if (!(pack > 0 && pack <= 220)) return 'חסר גודל אריזה בליטרים'
  const item_code = str(b.item_code, 40).toUpperCase()
  if (!item_code) return 'חסר מק"ט'
  const makes = list(b.makes).map((m) => m.toUpperCase())
  return { fluid, grade, pack_l: pack, item_code, makes: makes.length ? makes : null, sort: int(b.sort, 0, 10000, 100)!, note: opt(b.note, 200) }
}
