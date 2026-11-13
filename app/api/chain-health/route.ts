import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireReader } from '@/lib/vehicle-twins-proxy'

export const dynamic = 'force-dynamic'

/**
 * GET /api/chain-health — item codes whose supersession link in the ERP is broken or only half there.
 *
 * Every consumer (Diego web, the WhatsApp bot, this dashboard, FINAPI's canonical map) follows the
 * ERP's "replaced by" (new_item_id) / "previous" (old_item_id) fields. Fixing a link once in the ERP
 * fixes it everywhere, so this page lists what to fix (owner, 2026-11-13). Reads the Postgres replica
 * only (nightly ETL) — never the ERP's single Btrieve seat. Busiest items first.
 *
 *  missing   — "replaced by" holds something that is not an item: a shelf (6A-1), zeros, or a typo
 *  name_only — "replaced by" is empty but the NAME is another item's code, as written or reversed (how staff mark it);
 *              FINAPI follows it, but the field itself should carry it
 *  fork      — one old code is named as "previous" by two different items: replaced by two things
 */
type Row = { kind: 'missing' | 'name_only' | 'fork'; code: string; name: string | null; link: string; sold: number; stock: number }

let cache: { at: number; body: unknown } | null = null
const TTL = 6 * 3600 * 1000

export async function GET(req: Request) {
  const gate = await requireReader()
  if ('res' in gate) return gate.res
  const fresh = new URL(req.url).searchParams.get('fresh') === '1'
  if (!fresh && cache && Date.now() - cache.at < TTL) return NextResponse.json(cache.body)

  const sold = `coalesce(s.total_sold_this_year, 0)::float AS sold, coalesce(s.total_qty, 0)::float AS stock`
  const [missing, nameOnly, fork] = await Promise.all([
    query(
      `SELECT i.code, i.name, i.new_item_id AS link, ${sold}
         FROM erp.items i LEFT JOIN erp.stock_summary s ON s.item_code = i.code
        WHERE coalesce(trim(i.new_item_id), '') <> ''
          AND NOT EXISTS (SELECT 1 FROM erp.items j WHERE j.code = trim(i.new_item_id))
        ORDER BY sold DESC, i.code LIMIT 500`, []),
    // the same rule as FINAPI's name_pointer: the name as written OR reversed (the item file keeps
    // some text in visual order, so "1444TT" can come back as "TT4441"), and only when exactly one reading is an item
    query(
      `WITH c AS (
         SELECT i.code, i.name, upper(trim(i.name)) AS a, reverse(upper(trim(i.name))) AS b
           FROM erp.items i
          WHERE coalesce(trim(i.new_item_id), '') = ''
            AND upper(trim(i.name)) ~ '^[A-Z0-9][A-Z0-9./-]{3,19}$' AND trim(i.name) ~ '[0-9]')
       SELECT c.code, c.name, coalesce(ja.code, jb.code) AS link, ${sold}
         FROM c
         LEFT JOIN erp.items ja ON ja.code = c.a AND ja.code <> c.code
         LEFT JOIN erp.items jb ON jb.code = c.b AND jb.code <> c.code AND c.b <> c.a
         LEFT JOIN erp.stock_summary s ON s.item_code = c.code
        WHERE (ja.code IS NULL) <> (jb.code IS NULL)
        ORDER BY sold DESC, c.code LIMIT 500`, []),
    query(
      `SELECT x.code, x.name, string_agg(DISTINCT y.code, ', ') AS link, ${sold}
         FROM erp.items x
         JOIN erp.items y ON y.old_item_id = x.code AND y.code <> coalesce(trim(x.new_item_id), '')
         LEFT JOIN erp.stock_summary s ON s.item_code = x.code
        WHERE coalesce(trim(x.new_item_id), '') <> ''
        GROUP BY x.code, x.name, s.total_sold_this_year, s.total_qty
        ORDER BY sold DESC, x.code LIMIT 500`, []),
  ])
  const pick = (kind: Row['kind'], r: any): Row => ({
    kind, code: String(r.code), name: r.name ? String(r.name) : null, link: String(r.link ?? ''),
    sold: Number(r.sold ?? 0), stock: Number(r.stock ?? 0),
  })
  const rows: Row[] = [
    ...(missing.rows ?? []).map((r: any) => pick('missing', r)),
    ...(nameOnly.rows ?? []).map((r: any) => pick('name_only', r)),
    ...(fork.rows ?? []).map((r: any) => pick('fork', r)),
  ]
  const body = {
    at: new Date().toISOString(),
    counts: { missing: missing.rows?.length ?? 0, name_only: nameOnly.rows?.length ?? 0, fork: fork.rows?.length ?? 0 },
    rows,
  }
  cache = { at: Date.now(), body }
  return NextResponse.json(body)
}
