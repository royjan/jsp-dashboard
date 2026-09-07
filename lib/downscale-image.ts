/**
 * Client-side image downscaling, before an upload leaves the phone.
 *
 * Ported from jan-portal (`src/lib/downscaleImage.ts`, spec 2026-09-03), where
 * it exists because full-size banner PNGs cost ~6.8MB on a phone. The reason to
 * have it HERE is worse: a delivery photo is read with FileReader as a base64
 * data URL and POSTed as JSON into `dashboard.delivery_photos.photo_url` — so a
 * 6MB phone JPEG becomes an ~8MB request body AND an ~8MB row, over whatever
 * signal a driver has at the door. There is no image processing on the server
 * (`sharp` is absent, and the route stores the string it is given), so the only
 * place the bytes can be cut is the browser that produced them.
 *
 * It runs in the driver's browser rather than in a route because the CPU there
 * is free and no native dependency enters the Dockerfile.
 */

/**
 * Long-edge cap. 1600 keeps a shipping label, a signature and a damaged-carton
 * detail legible when the photo is opened full-screen, which is the whole point
 * of proof-of-delivery; the portal's 1200 is tuned for decorative banner art.
 */
export const DOWNSCALE_MAX_PX = 1600
/** WebP quality. 0.8 is visually indistinguishable on a phone photo at this size. */
export const DOWNSCALE_QUALITY = 0.8
/** Below this the file is already cheap; recompressing only risks making it worse. */
export const DOWNSCALE_SKIP_BYTES = 400 * 1024

/**
 * Scale (w,h) to fit a max long edge, preserving aspect. Never upscales, always
 * returns whole pixels >= 1 — a canvas sized 0 or fractional throws.
 */
export function fitWithin(w: number, h: number, max: number): { width: number; height: number } {
  const sw = Math.max(1, Math.round(w) || 1)
  const sh = Math.max(1, Math.round(h) || 1)
  const scale = Math.min(1, max / Math.max(sw, sh))
  return {
    width: Math.max(1, Math.round(sw * scale)),
    height: Math.max(1, Math.round(sh * scale)),
  }
}

export interface Downscaled {
  blob: Blob
  mime: string
}

/**
 * Re-encode an image smaller. Fails OPEN: any problem returns the source
 * untouched, because a proof-of-delivery photo must never fail to upload
 * because compression did not work.
 */
export async function downscaleImage(
  file: Blob,
  max: number = DOWNSCALE_MAX_PX,
  quality: number = DOWNSCALE_QUALITY,
): Promise<Downscaled> {
  const asIs: Downscaled = { blob: file, mime: file.type || 'image/jpeg' }
  try {
    if (typeof createImageBitmap !== 'function') return asIs
    const bmp = await createImageBitmap(file)
    const { width, height } = fitWithin(bmp.width, bmp.height, max)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bmp.close?.()
      return asIs
    }
    ctx.drawImage(bmp, 0, 0, width, height)
    bmp.close?.()
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/webp', quality))
    // toBlob yields null when the browser cannot encode WebP; and a tiny source
    // can re-encode LARGER than it started. Keep the original in both cases
    // rather than shipping a regression.
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return asIs
    return { blob, mime: 'image/webp' }
  } catch {
    return asIs
  }
}

/**
 * Blob → data URL. The delivery photo endpoint takes base64 in JSON, so the
 * downscaled blob has to be turned back into a string before it can be sent.
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

/** "1.4MB" / "312KB" — for telling the user what they are about to send. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0KB'
  return n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`
}

/**
 * Rough byte size of a base64 data URL — what actually crosses the wire and
 * lands in the row, which is ~4/3 of the blob it encodes.
 */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding)
}
