export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { authed, BOT_ID, SUPPLIER_CODE } from '@/lib/bot-suppliers-server'

/**
 * GET  /api/bot-suppliers?bot=v5  -> every supplier, its size, and how THIS bot shows it (null = not connected)
 * PUT  /api/bot-suppliers         -> {bot, supplier_code, enabled?, show_price?, price_field?, show_stock?, label?,
 *                                    max_alts?} connects / changes / disconnects one supplier for one bot
 */
export async function GET(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const bot = req.nextUrl.searchParams.get('bot') || ''
  if (!BOT_ID.test(bot)) return NextResponse.json({ error: 'bad bot id' }, { status: 400 })
  try {
    const pool = await getPool()
    const { rows } = await pool.query(
      `SELECT s.supplier_code, s.name, s.name_he, s.adapter, s.enabled, s.updated_at,
              (SELECT count(*) FROM suppliers.part p WHERE p.supplier_code = s.supplier_code) AS parts,
              (SELECT count(DISTINCT o.oem_code) FROM suppliers.part_oem o WHERE o.supplier_code = s.supplier_code) AS oems,
              (SELECT count(*) FROM suppliers.part p WHERE p.supplier_code = s.supplier_code AND p.in_stock) AS in_stock,
              (SELECT max(p.updated_at) FROM suppliers.part p WHERE p.supplier_code = s.supplier_code) AS data_at,
              (SELECT p.source FROM suppliers.part p WHERE p.supplier_code = s.supplier_code LIMIT 1) AS source,
              b.enabled AS b_enabled, b.show_price, b.price_field, b.show_stock, b.label, b.max_alts
         FROM suppliers.supplier s
         LEFT JOIN suppliers.bot_supplier b ON b.supplier_code = s.supplier_code AND b.bot_id = $1
        ORDER BY s.name`, [bot])
    return NextResponse.json({
      suppliers: rows.map((r) => ({
        supplier_code: r.supplier_code, name: r.name, name_he: r.name_he, adapter: r.adapter, enabled: r.enabled,
        parts: r.parts, oems: r.oems, in_stock: r.in_stock, data_at: r.data_at, source: r.source,
        bot: r.b_enabled === null ? null : {
          enabled: r.b_enabled, show_price: r.show_price, price_field: r.price_field, show_stock: r.show_stock,
          label: r.label, max_alts: r.max_alts,
        },
      })),
    })
  } catch (e) {
    // The schema not existing yet is a state, not a crash: no supplier has been loaded anywhere.
    const msg = e instanceof Error ? e.message : String(e)
    if (/relation "suppliers\./.test(msg)) return NextResponse.json({ suppliers: [] })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  if (!BOT_ID.test(String(b.bot || '')) || !SUPPLIER_CODE.test(String(b.supplier_code || '')))
    return NextResponse.json({ error: 'bot and supplier_code required' }, { status: 400 })
  const priceField = b.price_field === 'gross' ? 'gross' : 'net'
  const maxAlts = Math.max(1, Math.min(5, Number(b.max_alts) || 2))
  const label = typeof b.label === 'string' ? b.label.trim().slice(0, 40) || null : null
  try {
    const pool = await getPool()
    const { rows } = await pool.query(
      `INSERT INTO suppliers.bot_supplier (bot_id, supplier_code, enabled, show_price, price_field, show_stock, label, max_alts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (bot_id, supplier_code) DO UPDATE SET
         enabled = EXCLUDED.enabled, show_price = EXCLUDED.show_price, price_field = EXCLUDED.price_field,
         show_stock = EXCLUDED.show_stock, label = EXCLUDED.label, max_alts = EXCLUDED.max_alts
       RETURNING *`,
      [b.bot, b.supplier_code, b.enabled !== false, b.show_price !== false, priceField, b.show_stock !== false,
       label, maxAlts])
    return NextResponse.json({ ok: true, bot: rows[0] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
