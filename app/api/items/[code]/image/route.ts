import { initializeSecrets } from '@/lib/aws-secrets'
import { query } from '@/lib/db'

/**
 * The product photo staff uploaded in the portal, served straight from
 * `public.portal_item_flags` — the same row the portal reads. No copy, no CDN:
 * upload there, it is here on the next request.
 *
 * 404 when the item has no photo, which is the common case (a few dozen items
 * of the catalogue have one) — the card falls back to the diagram alone.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params
    const upper = decodeURIComponent(code || '').trim().toUpperCase()
    if (!upper) return new Response(null, { status: 404 })

    await initializeSecrets()
    const { rows } = await query(
      `SELECT image, image_mime, image_updated_at
         FROM public.portal_item_flags
        WHERE upper(item_code) = $1 AND image IS NOT NULL
        LIMIT 1`,
      [upper],
    )
    const row = rows[0]
    if (!row?.image) return new Response(null, { status: 404 })

    return new Response(Buffer.from(row.image), {
      headers: {
        'Content-Type': row.image_mime || 'image/jpeg',
        // The URL carries ?v=<image_updated_at>, so a long TTL is safe: a new
        // upload changes the URL.
        'Cache-Control': 'private, max-age=86400',
        ...(row.image_updated_at
          ? { ETag: `"${new Date(row.image_updated_at).getTime()}"` }
          : {}),
      },
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}
