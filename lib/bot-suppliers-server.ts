import { NextRequest } from 'next/server'
import { verifyJanSession, JAN_SESSION_COOKIE } from '@/lib/jan-sso'

/**
 * Supplier alternatives for the Diego bots (2026-10-14): the `suppliers` schema in the fleet database.
 *
 *   suppliers.supplier      who (Comet = 'comet'), how they connect (adapter), on/off for every bot
 *   suppliers.part          the supplier's own item, PK (supplier_code, brand, part_no)
 *   suppliers.part_oem      which OEM numbers it replaces, normalised by `normOem`
 *   suppliers.bot_supplier  per bot: shown or not, which price, stock, label, how many lines
 *
 * The bots hold the whole OEM map in memory (v5: peers/catalog/suppliers.py). Every write to these tables fires
 * NOTIFY suppliers_changed (trigger suppliers.notify_changed) and the bot reloads about a second later - no restart,
 * no polling. Its hourly re-read is only a safety net.
 */

/** The one spelling OEM numbers are matched by. MUST stay identical to the bots' `norm` (suppliers.py). */
export function normOem(code: unknown): string {
  return String(code ?? '').replace(/[\s.\-/]+/g, '').toUpperCase()
}

/** Same rule as /api/bots: every call needs a signed-in user once auth is configured. */
export async function authed(req: NextRequest): Promise<boolean> {
  const configured = !!(process.env.JAN_AUTH_JWT_SECRET || process.env.JWT_SECRET || process.env.AUTH_SECRET)
  if (!configured) return true
  return !!(await verifyJanSession(req.cookies.get(JAN_SESSION_COOKIE)?.value))
}

export const BOT_ID = /^[a-z0-9-]{1,32}$/
export const SUPPLIER_CODE = /^[a-z0-9_-]{1,32}$/
