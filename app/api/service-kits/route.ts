export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import type { PoolClient } from 'pg'
import { getPool } from '@/lib/db'
import { whoIs, kitIn, itemIn, productIn, UUID } from '@/lib/service-kits-server'

/**
 * GET    /api/service-kits                      -> { kits: [...with items], products: [...] }  (kind='service' only)
 * POST   /api/service-kits {entity, ...fields}  -> create a kit (optionally copy_from another kit's items), item or product
 * PUT    /api/service-kits {entity, id, ...}    -> change one
 * DELETE /api/service-kits?entity=&id=          -> remove one (a kit takes its items with it - FK cascade)
 *
 * entity = kit | item | product. Only kind='service' kits are reachable: the old keyword kits stay jsp-chat-js'.
 * Every write keeps kits.part_descriptions (what /api/agent/kit and the MCP jan_expand_kit read) equal to the
 * kit's items, and fires NOTIFY kits_changed through the table triggers.
 */
const KIT_COLS = 'k.id::text, k.name, k.fuel_types, k.makes, k.priority, k.is_active, k.created_by, k.updated_at'
const ITEM_COLS = `id, kit_id::text, sort, part_en, part_he, match_he, source, fluid, qty, unit, qty_from, every_km,
                   every_months, needs, basic, optional, note_he, created_by, updated_at, updated_by`

export async function GET(req: NextRequest) {
  if ((await whoIs(req)) === false) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const pool = await getPool()
    const [kits, items, products] = await Promise.all([
      pool.query(`SELECT ${KIT_COLS} FROM public.kits k WHERE k.kind = 'service' ORDER BY k.priority, k.name`),
      pool.query(`SELECT ${ITEM_COLS} FROM public.kit_items WHERE kit_id IN (SELECT id FROM public.kits WHERE kind = 'service')
                   ORDER BY sort, id`),
      pool.query(`SELECT id, fluid, grade, pack_l, item_code, makes, sort, note, created_by, updated_at, updated_by
                    FROM public.kit_products ORDER BY fluid, grade, sort, pack_l DESC, item_code`),
    ])
    return NextResponse.json({
      kits: kits.rows.map((k) => ({ ...k, items: items.rows.filter((i) => i.kit_id === k.id) })),
      products: products.rows,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/relation "public\.kit_(items|products)"|column k\.kind/.test(msg)) return NextResponse.json({ kits: [], products: [] })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** The kit must exist AND be a service kit - a bundle kit id is refused like an unknown one. */
async function serviceKit(c: PoolClient, id: unknown): Promise<string | null> {
  if (!UUID.test(String(id || ''))) return null
  const { rows } = await c.query(`SELECT id::text FROM public.kits WHERE id = $1 AND kind = 'service'`, [id])
  return rows[0]?.id ?? null
}

async function syncDescriptions(c: PoolClient, kitId: string) {
  await c.query(
    `UPDATE public.kits SET updated_at = now(),
            part_descriptions = ARRAY(SELECT part_he FROM public.kit_items WHERE kit_id = $1 ORDER BY sort, id)
      WHERE id = $1`, [kitId])
}

async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await (await getPool()).connect()
  try {
    await c.query('BEGIN')
    const out = await fn(c)
    await c.query('COMMIT')
    return out
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    c.release()
  }
}

class Bad extends Error {}
const fail = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e)
  if (e instanceof Bad) return NextResponse.json({ error: msg }, { status: 400 })
  if (/kit_products_fluid_grade_item_code_key/.test(msg))
    return NextResponse.json({ error: 'המק"ט הזה כבר רשום לנוזל ולדרגה האלה' }, { status: 409 })
  return NextResponse.json({ error: msg }, { status: 500 })
}

export async function POST(req: NextRequest) {
  const who = await whoIs(req)
  if (who === false) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  try {
    const out = await tx(async (c) => {
      if (b.entity === 'kit') {
        const k = kitIn(b)
        if (typeof k === 'string') throw new Bad(k)
        const { rows } = await c.query(
          `INSERT INTO public.kits (name, kind, fuel_types, makes, priority, is_active, keywords, part_descriptions, created_by, updated_at)
           VALUES ($1, 'service', $2, $3, $4, $5, ARRAY[]::text[], ARRAY[]::text[], $6, now()) RETURNING id::text`,
          [k.name, k.fuel_types, k.makes, k.priority, k.is_active, who || null])
        const id = rows[0].id as string
        const from = b.copy_from ? await serviceKit(c, b.copy_from) : null
        if (from) {
          await c.query(
            `INSERT INTO public.kit_items (kit_id, sort, part_en, part_he, match_he, source, fluid, qty, unit, qty_from, every_km,
                                          every_months, needs, basic, optional, note_he, created_by)
             SELECT $1, sort, part_en, part_he, match_he, source, fluid, qty, unit, qty_from, every_km,
                    every_months, needs, basic, optional, note_he, $3
               FROM public.kit_items WHERE kit_id = $2`, [id, from, who || null])
          await syncDescriptions(c, id)
        }
        return { id }
      }
      if (b.entity === 'item') {
        const kitId = await serviceKit(c, b.kit_id)
        if (!kitId) throw new Bad('ערכת טיפול לא נמצאה')
        const i = itemIn(b)
        if (typeof i === 'string') throw new Bad(i)
        const { rows } = await c.query(
          `INSERT INTO public.kit_items (kit_id, sort, part_en, part_he, match_he, source, fluid, qty, unit, qty_from, every_km,
                                        every_months, needs, basic, optional, note_he, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
          [kitId, i.sort, i.part_en, i.part_he, i.match_he, i.source, i.fluid, i.qty, i.unit, i.qty_from, i.every_km,
           i.every_months, i.needs, i.basic, i.optional, i.note_he, who || null])
        await syncDescriptions(c, kitId)
        return { id: rows[0].id }
      }
      if (b.entity === 'product') {
        const p = productIn(b)
        if (typeof p === 'string') throw new Bad(p)
        const { rows } = await c.query(
          `INSERT INTO public.kit_products (fluid, grade, pack_l, item_code, makes, sort, note, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [p.fluid, p.grade, p.pack_l, p.item_code, p.makes, p.sort, p.note, who || null])
        return { id: rows[0].id }
      }
      throw new Bad('entity must be kit, item or product')
    })
    return NextResponse.json({ ok: true, ...out })
  } catch (e) {
    return fail(e)
  }
}

export async function PUT(req: NextRequest) {
  const who = await whoIs(req)
  if (who === false) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  try {
    await tx(async (c) => {
      if (b.entity === 'kit') {
        const id = await serviceKit(c, b.id)
        if (!id) throw new Bad('ערכת טיפול לא נמצאה')
        const k = kitIn(b)
        if (typeof k === 'string') throw new Bad(k)
        await c.query(
          `UPDATE public.kits SET name = $2, fuel_types = $3, makes = $4, priority = $5, is_active = $6, updated_at = now()
            WHERE id = $1`, [id, k.name, k.fuel_types, k.makes, k.priority, k.is_active])
        return
      }
      if (b.entity === 'item') {
        const { rows } = await c.query(
          `SELECT i.kit_id::text FROM public.kit_items i JOIN public.kits k ON k.id = i.kit_id
            WHERE i.id = $1 AND k.kind = 'service'`, [Number(b.id) || 0])
        if (!rows[0]) throw new Bad('הפריט לא נמצא')
        const i = itemIn(b)
        if (typeof i === 'string') throw new Bad(i)
        await c.query(
          `UPDATE public.kit_items SET sort=$2, part_en=$3, part_he=$4, match_he=$5, source=$6, fluid=$7, qty=$8, unit=$9,
                  qty_from=$10, every_km=$11, every_months=$12, needs=$13, basic=$14, optional=$15, note_he=$16,
                  updated_at = now(), updated_by = $17
            WHERE id = $1`,
          [Number(b.id), i.sort, i.part_en, i.part_he, i.match_he, i.source, i.fluid, i.qty, i.unit, i.qty_from,
           i.every_km, i.every_months, i.needs, i.basic, i.optional, i.note_he, who || null])
        await syncDescriptions(c, rows[0].kit_id)
        return
      }
      if (b.entity === 'product') {
        const p = productIn(b)
        if (typeof p === 'string') throw new Bad(p)
        const r = await c.query(
          `UPDATE public.kit_products SET fluid=$2, grade=$3, pack_l=$4, item_code=$5, makes=$6, sort=$7, note=$8,
                  updated_at = now(), updated_by = $9 WHERE id = $1`,
          [Number(b.id) || 0, p.fluid, p.grade, p.pack_l, p.item_code, p.makes, p.sort, p.note, who || null])
        if (!r.rowCount) throw new Bad('המק"ט לא נמצא')
        return
      }
      throw new Bad('entity must be kit, item or product')
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return fail(e)
  }
}

export async function DELETE(req: NextRequest) {
  if ((await whoIs(req)) === false) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const entity = req.nextUrl.searchParams.get('entity')
  const id = req.nextUrl.searchParams.get('id') || ''
  try {
    await tx(async (c) => {
      if (entity === 'kit') {
        const kid = await serviceKit(c, id)
        if (!kid) throw new Bad('ערכת טיפול לא נמצאה')
        await c.query(`DELETE FROM public.kits WHERE id = $1 AND kind = 'service'`, [kid])
        return
      }
      if (entity === 'item') {
        const { rows } = await c.query(
          `DELETE FROM public.kit_items i USING public.kits k
            WHERE i.id = $1 AND k.id = i.kit_id AND k.kind = 'service' RETURNING i.kit_id::text`, [Number(id) || 0])
        if (!rows[0]) throw new Bad('הפריט לא נמצא')
        await syncDescriptions(c, rows[0].kit_id)
        return
      }
      if (entity === 'product') {
        const r = await c.query(`DELETE FROM public.kit_products WHERE id = $1`, [Number(id) || 0])
        if (!r.rowCount) throw new Bad('המק"ט לא נמצא')
        return
      }
      throw new Bad('entity must be kit, item or product')
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return fail(e)
  }
}
