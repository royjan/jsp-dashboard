export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { getPool } from '@/lib/db'
import { authed, normOem, BOT_ID, SUPPLIER_CODE } from '@/lib/bot-suppliers-server'

/**
 * POST /api/bot-suppliers/upload  (multipart: file, supplier_code, name, name_he, bot?, sheet?)
 *
 * THE FILE ADAPTER. A supplier's price sheet -> suppliers.part + part_oem, as a FULL REPLACE of that supplier in
 * one transaction: an item missing from the new file is gone from the bots on their next refresh, and a failed
 * upload leaves the old data exactly as it was. Same rules as claude-work/suppliers-v5/ops/comet_xlsx.py:
 *
 *   * the header row is found by its Hebrew column names, on the first sheet that has them (or `sheet`)
 *   * an OEM cell lists several numbers, comma separated; an export cut at 50 characters loses its LAST number
 *   * the supplier's own number is often a prefix + the OEM number (ORG/DIN/SOE/PEU/TYE), so that OEM is kept too
 *   * an empty stock cell means in stock; "חסר" means out
 *
 * `bot` connects the supplier to that bot as well (part number only: price and stock off) when it is not connected yet.
 */
const COLS: Record<string, (h: string) => boolean> = {
  part_no: (h) => /^מק["״']?ט$/.test(h),
  description: (h) => /שם פריט|תיאור/.test(h),
  brand: (h) => /ספק\/יצרן|יצרן|מותג/.test(h),
  price_gross: (h) => /ברוטו/.test(h),
  price_net: (h) => /נטו/.test(h),
  discount_pct: (h) => /הנחה/.test(h),
  oem: (h) => /OEM/i.test(h),
  stock: (h) => /מצב מלאי|^מלאי$/.test(h),
  barcode: (h) => /ברקוד/.test(h),
}
const CUT_AT = 50
const PREFIX = /^(?:ORG|DIN|SOE|PEU|TYE)\s*/i

const num = (v: unknown): number | null => {
  const n = parseFloat(String(v ?? '').replace(/[,₪\s]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

function oemsOf(cell: unknown, partNo: string): [string, string][] {
  const raw = String(cell ?? '').trim()
  let toks = raw.split(',').map((t) => t.trim())
  if (raw.length >= CUT_AT && !raw.endsWith(',')) toks = toks.slice(0, -1)
  const out = new Map<string, string>()
  for (const t of toks) {
    const n = normOem(t)
    if (n.length >= 4 && !out.has(n)) out.set(n, t)
  }
  const derived = partNo.replace(PREFIX, '')
  if (derived !== partNo) {
    const n = normOem(derived)
    if (n.length >= 5 && /\d/.test(n) && !out.has(n)) out.set(n, derived)
  }
  return [...out.entries()]
}

export async function POST(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const form = await req.formData()
  const file = form.get('file')
  const code = String(form.get('supplier_code') || '').trim().toLowerCase()
  const name = String(form.get('name') || '').trim() || code
  const nameHe = String(form.get('name_he') || '').trim() || null
  const bot = String(form.get('bot') || '').trim()
  const wantSheet = String(form.get('sheet') || '').trim()
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (!SUPPLIER_CODE.test(code)) return NextResponse.json({ error: 'supplier_code: a-z, 0-9, _ or -' }, { status: 400 })
  if (bot && !BOT_ID.test(bot)) return NextResponse.json({ error: 'bad bot id' }, { status: 400 })

  const wb = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: 'buffer' })
  let found: { sheet: string; header: number; col: Record<string, number>; rows: unknown[][] } | null = null
  for (const sheet of wb.SheetNames) {
    if (wantSheet && !sheet.toLowerCase().startsWith(wantSheet.toLowerCase())) continue
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, defval: null, raw: true })
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const hdr = (rows[i] || []).map((h) => String(h ?? '').trim())
      const col: Record<string, number> = {}
      for (const [k, test] of Object.entries(COLS)) {
        const j = hdr.findIndex((h) => h && test(h))
        if (j >= 0) col[k] = j
      }
      if (col.part_no !== undefined && col.oem !== undefined) { found = { sheet, header: i, col, rows }; break }
    }
    if (found) break
  }
  if (!found) return NextResponse.json({ error: 'no sheet with the columns מק"ט and מק"ט OEM' }, { status: 400 })

  const { col, rows, sheet, header } = found
  const at = (r: unknown[], k: string) => (col[k] === undefined ? null : r[col[k]])
  const items: { brand: string; part_no: string; description: string | null; gross: number | null; net: number | null;
                 discount: number | null; in_stock: boolean; stock_text: string; barcode: string | null;
                 oems: [string, string][]; raw: Record<string, unknown> }[] = []
  const seen = new Set<string>()
  const head = (rows[header] || []).map((h) => String(h ?? ''))
  for (const r of rows.slice(header + 1)) {
    const partNo = String(at(r, 'part_no') ?? '').trim()
    if (!partNo) continue
    const brand = String(at(r, 'brand') ?? '').trim() || '-'
    const key = `${brand}\u0000${partNo}`
    if (seen.has(key)) continue
    seen.add(key)
    const stockText = String(at(r, 'stock') ?? '').trim()
    items.push({
      brand, part_no: partNo, description: String(at(r, 'description') ?? '').trim() || null,
      gross: num(at(r, 'price_gross')), net: num(at(r, 'price_net')), discount: num(at(r, 'discount_pct')),
      in_stock: !stockText.includes('חסר'), stock_text: stockText || 'במלאי',
      barcode: at(r, 'barcode') ? String(at(r, 'barcode')).trim() : null,
      oems: oemsOf(at(r, 'oem'), partNo),
      raw: Object.fromEntries(head.map((h, j) => [h || `col${j}`, r[j] ?? null])),
    })
  }
  if (!items.length) return NextResponse.json({ error: 'the sheet has no item rows' }, { status: 400 })

  const source = `${file.name}#${sheet}`
  const pool = await getPool()
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query(
      `INSERT INTO suppliers.supplier (supplier_code, name, name_he, adapter) VALUES ($1, $2, $3, 'file')
       ON CONFLICT (supplier_code) DO UPDATE SET name = EXCLUDED.name,
         name_he = coalesce(EXCLUDED.name_he, suppliers.supplier.name_he), updated_at = now()`, [code, name, nameHe])
    await c.query('DELETE FROM suppliers.part WHERE supplier_code = $1', [code])
    let links = 0
    for (const it of items) {
      await c.query(
        `INSERT INTO suppliers.part (supplier_code, brand, part_no, description, price_gross, price_net, discount_pct,
                                     in_stock, stock_text, barcode, source, raw)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [code, it.brand, it.part_no, it.description, it.gross, it.net, it.discount, it.in_stock, it.stock_text,
         it.barcode, source, JSON.stringify(it.raw)])
      for (const [oem, raw] of it.oems) {
        await c.query(
          `INSERT INTO suppliers.part_oem (supplier_code, brand, part_no, oem_code, oem_raw) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT DO NOTHING`, [code, it.brand, it.part_no, oem, raw])
        links++
      }
    }
    if (bot) {
      await c.query(`INSERT INTO suppliers.bot_supplier (bot_id, supplier_code) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                    [bot, code])
    }
    await c.query('COMMIT')
    return NextResponse.json({ ok: true, supplier_code: code, sheet, items: items.length, oem_links: links,
                               in_stock: items.filter((i) => i.in_stock).length, source })
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  } finally {
    c.release()
  }
}
