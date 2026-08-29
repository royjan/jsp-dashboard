import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'
import { partlyCandidates, partlyMatchForms } from '@/lib/partly-codes'
import { itemChainCodes } from '@/lib/services/analytics-service'

/**
 * What a part LOOKS like: the photo staff uploaded in the portal, and the
 * exploded diagram it sits in — with its own callout number marked.
 *
 * Both already exist, on the same database this app is already connected to,
 * and neither was reachable from the dashboard: the photo lives in
 * `public.portal_item_flags.image` (written by the portal's admin screen) and
 * the diagram in `partly.schemas.coordinates` + `partly.project_parts`. Nothing
 * is copied or synced — a photo uploaded in the portal is visible here on the
 * next request.
 *
 * Always 200. This feeds one secondary card and must never break the item page,
 * so every failure degrades to "no media" rather than an error.
 */

interface Marker { x: number; y: number; radius: number }
interface Coordinates {
  imageUrl?: string
  width?: number | string
  height?: number | string
  positions?: Record<string, Marker[]>
}
interface SchemaRow { schema_id: string; name: string; coordinates: Coordinates | null; scheme_number: string | null }
interface PartRow { scheme_number: string | null; hebrew_description: string | null; description: string | null }

/**
 * The callout numbers are stored zero-padded ('01'..'22') while
 * `scheme_number` is not ('1'), so a string compare silently finds nothing —
 * which reads as "this part is not on its own diagram".
 */
function markersFor(coordinates: Coordinates | null, scheme: string): Marker[] | null {
  const positions = coordinates?.positions
  if (!positions || !scheme) return null
  const want = String(scheme).trim()
  const wantNum = Number(want)
  for (const [key, pts] of Object.entries(positions)) {
    const sameNum = Number.isFinite(wantNum) && Number(key) === wantNum
    if (key === want || sameNum) return Array.isArray(pts) ? (pts as Marker[]) : null
  }
  return null
}

/** Every OTHER callout on the same diagram, so a marker can name its part. */
function othersFor(coordinates: Coordinates | null, ownScheme: string, rows: PartRow[]) {
  const positions = coordinates?.positions ?? {}
  const nameByScheme = new Map<string, string>()
  for (const r of rows) {
    const key = String(r.scheme_number ?? '').trim()
    if (!key || nameByScheme.has(key)) continue
    nameByScheme.set(key, r.hebrew_description || r.description || '')
  }
  const ownNum = Number(String(ownScheme).trim())
  const out: { scheme: string; name: string; markers: Marker[] }[] = []
  for (const [key, pts] of Object.entries(positions)) {
    const num = Number(key)
    if (Number.isFinite(ownNum) && num === ownNum) continue
    const label = Number.isFinite(num) ? String(num) : key
    out.push({
      scheme: label,
      name: nameByScheme.get(label) || nameByScheme.get(key) || '',
      markers: Array.isArray(pts) ? (pts as Marker[]) : [],
    })
  }
  return out
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const empty = { hasImage: false, imageVersion: null as string | null, diagram: null }
  try {
    const { code } = await params
    const upper = decodeURIComponent(code || '').trim().toUpperCase()
    if (!upper) return NextResponse.json(empty)

    await initializeSecrets()

    // The photo is keyed by the ERP code; the diagram lives on whatever
    // spelling partly stores (MG prefix, manual mapping, superseded code), so
    // it needs the same fan-out the vehicles card uses.
    const chain = await itemChainCodes(upper).catch(() => [upper])
    const candidates = (
      await Promise.all(chain.map((c) => partlyCandidates(c).catch(() => [c])))
    ).flat()
    const forms = partlyMatchForms(candidates.length > 0 ? candidates : [upper])

    const [imgRes, schemaRes] = await Promise.all([
      query(
        `SELECT item_code, image_updated_at
           FROM public.portal_item_flags
          WHERE image IS NOT NULL AND upper(item_code) = ANY($1)
          ORDER BY array_position($1, upper(item_code)) LIMIT 1`,
        [chain.map((c) => String(c).toUpperCase())],
      ).catch(() => null),
      forms.length === 0 ? null : query(
        `SELECT s.id AS schema_id, s.name, s.coordinates, pp.scheme_number
           FROM partly.project_parts pp
           JOIN partly.global_parts gp ON gp.id = pp.global_part_id
           JOIN partly.schemas s ON s.id = pp.schema_id
          WHERE upper(regexp_replace(gp.item_number, '[^A-Za-z0-9]', '', 'g')) = ANY($1)
            AND pp.deleted_at IS NULL
            AND s.coordinates->>'imageUrl' ~ 'screenshots'
          -- Richest diagram first. A part sits on many scans of the same
          -- assembly and they are not equally complete; picking whichever row
          -- came back first showed a 3-callout crop of an 8-callout drawing.
          ORDER BY (SELECT count(*) FROM jsonb_object_keys(
                      COALESCE(s.coordinates->'positions', '{}'::jsonb))) DESC
          LIMIT 12`,
        [forms],
      ).catch(() => null),
    ])

    const imgRow = imgRes?.rows?.[0]

    // Prefer a diagram this part is actually MARKED on; fall back to the first
    // one it belongs to (a diagram with no callout is still worth showing).
    const rows: SchemaRow[] = schemaRes?.rows ?? []
    let chosen: SchemaRow | null = null
    let markers: Marker[] = []
    for (const r of rows) {
      const m = markersFor(r.coordinates, String(r.scheme_number ?? ''))
      if (m?.length) { chosen = r; markers = m; break }
    }
    if (!chosen && rows[0]) chosen = rows[0]

    let diagram = null
    if (chosen?.coordinates?.imageUrl) {
      const partsRes = await query(
        `SELECT pp.scheme_number, gp.hebrew_description, gp.description
           FROM partly.project_parts pp
           JOIN partly.global_parts gp ON gp.id = pp.global_part_id
          WHERE pp.schema_id = $1 AND pp.deleted_at IS NULL`,
        [chosen.schema_id],
      ).catch(() => null)

      const ownNum = Number(String(chosen.scheme_number ?? '').trim())
      diagram = {
        schemaName: chosen.name as string,
        imageUrl: chosen.coordinates.imageUrl as string,
        width: Number(chosen.coordinates.width) || 450,
        height: Number(chosen.coordinates.height) || 545,
        scheme: Number.isFinite(ownNum) ? String(ownNum) : String(chosen.scheme_number ?? ''),
        markers,
        others: othersFor(chosen.coordinates, String(chosen.scheme_number ?? ''), (partsRes?.rows ?? []) as PartRow[]),
      }
    }

    return NextResponse.json({
      hasImage: !!imgRow,
      // The <img> cache-busts on this, so an admin re-upload shows up without
      // a hard refresh.
      imageVersion: imgRow?.image_updated_at ? new Date(imgRow.image_updated_at).getTime() : null,
      imageCode: imgRow?.item_code ?? null,
      diagram,
    })
  } catch {
    return NextResponse.json(empty)
  }
}
