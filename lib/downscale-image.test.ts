import { describe, expect, it } from 'vitest'
import { dataUrlBytes, fitWithin, formatBytes } from './downscale-image'

/**
 * The pure half only. `downscaleImage()` itself needs createImageBitmap, a
 * canvas and a WebP encoder, so it is verified in a real browser instead —
 * measured on a 4032x3024 JPEG: 9.5MB in, 983KB out, and a 127-byte PNG
 * returned as the identical Blob.
 */

describe('fitWithin', () => {
  it('scales a phone photo down to the long edge, keeping aspect', () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 })
    expect(fitWithin(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('never upscales — a small image is left alone', () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })

  it('always returns whole pixels of at least 1', () => {
    // A canvas sized 0 or fractional throws, which would take the upload down
    // with it — and the caller's whole contract is that it cannot fail.
    expect(fitWithin(0, 0, 1600)).toEqual({ width: 1, height: 1 })
    expect(fitWithin(3, 1, 2)).toEqual({ width: 2, height: 1 })
    const odd = fitWithin(1001, 333, 100)
    expect(Number.isInteger(odd.width)).toBe(true)
    expect(Number.isInteger(odd.height)).toBe(true)
    expect(odd.height).toBeGreaterThanOrEqual(1)
  })
})

describe('dataUrlBytes', () => {
  it('measures what actually crosses the wire, not the string length', () => {
    // The photo travels as base64 inside JSON and is stored as that string,
    // so ~4/3 of the blob is the number that matters.
    expect(dataUrlBytes('data:image/webp;base64,AAAA')).toBe(3)
    expect(dataUrlBytes('data:image/webp;base64,AAA=')).toBe(2)
    expect(dataUrlBytes('data:image/webp;base64,AA==')).toBe(1)
  })

  it('handles a bare base64 payload with no data: prefix', () => {
    expect(dataUrlBytes('AAAA')).toBe(3)
  })

  it('is 0, never negative, for empty input', () => {
    expect(dataUrlBytes('')).toBe(0)
    expect(dataUrlBytes('data:image/webp;base64,')).toBe(0)
  })
})

describe('formatBytes', () => {
  it('switches to MB only above a megabyte', () => {
    expect(formatBytes(983 * 1024)).toBe('983KB')
    expect(formatBytes(9.5 * 1024 * 1024)).toBe('9.5MB')
    expect(formatBytes(1024 * 1024)).toBe('1.0MB')
  })

  it('shows nothing alarming for absent or nonsense sizes', () => {
    expect(formatBytes(0)).toBe('0KB')
    expect(formatBytes(-1)).toBe('0KB')
    expect(formatBytes(NaN)).toBe('0KB')
  })
})
