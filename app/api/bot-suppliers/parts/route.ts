export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getPool } from '@/lib/db'
import { authed, normOem, SUPPLIER_CODE } from '@/lib/bot-suppliers-server'

/**
 * GET /api/bot-suppliers/parts?supplier=comet&q=9813930180&offset=0&limit=50
 *
 * The mapping itself: each supplier item with every OEM number it stands for. `q` matches an OEM number (in any
 * spelling - dots, spaces, dashes do not matter), the supplier's own number, or the description.
 */
export async function GET(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const supplier = sp.get('supplier') || ''
  if (!SUPPLIER_CODE.test(supplier)) return NextResponse.json({ error: 'bad supplier' }, { status: 400 })
  const q = (sp.get('q') || '').trim()
  const limit = Math.max(1, Math.min(200, Number(sp.get('limit')) || 50))
  const offset = Math.max(0, Number(sp.get('offset')) || 0)
  const params: unknown[] = [supplier]
  let where = 'p.supplier_code = $1'
  if (q) {
    params.push(`%${normOem(q)}%`, `%${q}%`)
    where += ` AND (EXISTS (SELECT 1 FROM suppliers.part_oem x WHERE x.supplier_code = p.supplier_code
                              AND x.brand = p.brand AND x.part_no = p.part_no AND x.oem_code LIKE $2)
                    OR p.part_no ILIKE $3 OR p.description ILIKE $3)`
  }
  try {
    const pool = await getPool()
    const total = (await pool.query(`SELECT count(*) AS n FROM suppliers.part p WHERE ${where}`, params)).rows[0].n
    const { rows } = await pool.query(
      `SELECT p.brand, p.part_no, p.description, p.price_gross, p.price_net, p.discount_pct, p.in_stock,
              p.stock_text, p.updated_at,
              coalesce((SELECT array_agg(o.oem_code ORDER BY o.oem_code) FROM suppliers.part_oem o
                         WHERE o.supplier_code = p.supplier_code AND o.brand = p.brand AND o.part_no = p.part_no),
                       '{}') AS oems
         FROM suppliers.part p WHERE ${where}
        ORDER BY p.part_no LIMIT ${limit} OFFSET ${offset}`, params)
    return NextResponse.json({ total, offset, limit, items: rows })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
