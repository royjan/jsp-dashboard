import { query } from '@/lib/db'
import { translateTerm } from '@/lib/gemini'
import { backfillEmbeddings } from '@/lib/chat-admin/flow-decisions'

/* eslint-disable @typescript-eslint/no-explicit-any */

const NON_ASCII = /[^\x00-\x7f]/

/**
 * Normalize every flow-decision part_description to English (all statuses).
 *
 * A unique constraint on (part_description, lambda, vehicle-scope) means a Hebrew row whose English
 * translation already exists (same scope) is a TRUE duplicate — it can't coexist, so we keep the
 * newer of the two and DELETE the older (the "overwrite by the newest" rule). New English terms are
 * inserted into part_descriptions and embedded so the simulator/tracer can still match them.
 *
 * Idempotent: already-English rows are untouched. Pass dryRun to preview without writing.
 */
export async function normalizeFlowDescriptionsToEnglish(opts: { dryRun?: boolean } = {}) {
  const dry = !!opts.dryRun
  const rows = (await query(
    `SELECT id, part_description, lambda_target, status, created_at,
            vehicle_year_from, vehicle_year_to, vehicle_model, vehicle_fuel_type, vehicle_engine_model, vin_pattern
     FROM flow_decisions_v2 WHERE part_description ~ '[^[:ascii:]]'
     ORDER BY created_at DESC`, [],
  )).rows as any[]

  const actions: any[] = []
  const newDescs = new Set<string>()
  let translated = 0, deletedDup = 0, skipped = 0

  for (const r of rows) {
    let en = ''
    try { en = (await translateTerm(r.part_description, 'he', 'en')).trim().toLowerCase() } catch { en = '' }
    if (!en || NON_ASCII.test(en)) { skipped++; actions.push({ id: r.id, from: r.part_description, note: 'no clean english' }); continue }

    // Would this English value collide with another row on the unique key?
    const coll = (await query(
      `SELECT id, created_at FROM flow_decisions_v2
       WHERE lower(part_description) = lower($1)
         AND lambda_target IS NOT DISTINCT FROM $2
         AND vehicle_year_from IS NOT DISTINCT FROM $3 AND vehicle_year_to IS NOT DISTINCT FROM $4
         AND vehicle_model IS NOT DISTINCT FROM $5 AND vehicle_fuel_type IS NOT DISTINCT FROM $6
         AND vehicle_engine_model IS NOT DISTINCT FROM $7 AND vin_pattern IS NOT DISTINCT FROM $8
         AND id <> $9 LIMIT 1`,
      [en, r.lambda_target, r.vehicle_year_from, r.vehicle_year_to, r.vehicle_model,
       r.vehicle_fuel_type, r.vehicle_engine_model, r.vin_pattern, r.id],
    )).rows[0] as any

    if (coll) {
      const existingNewer = new Date(coll.created_at) >= new Date(r.created_at)
      if (existingNewer) {
        actions.push({ id: r.id, from: r.part_description, to: en, action: 'delete-duplicate (existing is newer)' })
        if (!dry) await query(`DELETE FROM flow_decisions_v2 WHERE id = $1`, [r.id])
        deletedDup++
      } else {
        actions.push({ id: r.id, from: r.part_description, to: en, action: 'this is newer → delete existing, translate this' })
        if (!dry) {
          await query(`DELETE FROM flow_decisions_v2 WHERE id = $1`, [coll.id])
          await query(`UPDATE flow_decisions_v2 SET part_description = $2, updated_at = now() WHERE id = $1`, [r.id, en])
        }
        deletedDup++; translated++; newDescs.add(en)
      }
    } else {
      // No collision seen — but guard the write anyway: if a same-scope English row snuck in
      // (e.g. a prior row in this same run translated to the same term), the unique constraint
      // fires; treat this row as the duplicate and drop it instead of aborting the whole migration.
      if (!dry) {
        try {
          await query(`UPDATE flow_decisions_v2 SET part_description = $2, updated_at = now() WHERE id = $1`, [r.id, en])
          translated++; newDescs.add(en)
          actions.push({ id: r.id, from: r.part_description, to: en, action: 'translate' })
        } catch {
          await query(`DELETE FROM flow_decisions_v2 WHERE id = $1`, [r.id])
          deletedDup++
          actions.push({ id: r.id, from: r.part_description, to: en, action: 'translate collided → deleted as duplicate' })
        }
      } else {
        translated++; newDescs.add(en)
        actions.push({ id: r.id, from: r.part_description, to: en, action: 'translate' })
      }
    }
  }

  // Make sure every (now-English) flow-decision part_description exists in part_descriptions, then
  // embed the gaps (reuses the shared backfill so the simulator/tracer can match the new terms).
  let embedded = 0
  if (!dry) {
    void newDescs
    await query(
      `INSERT INTO part_descriptions (description, original_description, updated_at)
       SELECT DISTINCT part_description, part_description, now()
       FROM flow_decisions_v2 WHERE part_description IS NOT NULL AND part_description <> ''
       ON CONFLICT (description) DO NOTHING`, [],
    )
    embedded = (await backfillEmbeddings()).filled
  }

  const remaining = ((await query(`SELECT count(*)::int c FROM flow_decisions_v2 WHERE part_description ~ '[^[:ascii:]]'`, [])).rows[0] as any).c
  return { candidates: rows.length, translated, deletedDup, skipped, embedded, remaining, dryRun: dry, actions: actions.slice(0, 200) }
}
