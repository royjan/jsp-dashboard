import { describe, expect, it } from 'vitest'
import { familyOf, familyFromSlug, sharesNumbering } from './brand'

describe('familyOf', () => {
  it('folds Partly project makes into families', () => {
    expect(familyOf('סיטרואן')).toBe('PSA')
    expect(familyOf('פיג׳ו')).toBe('PSA')
    expect(familyOf('אופל')).toBe('PSA')
    expect(familyOf('די אס')).toBe('PSA')
    expect(familyOf('אמ ג׳י')).toBe('MG')
    expect(familyOf('מ.ג סין')).toBe('MG')
    expect(familyOf('וולבו שוודיה')).toBe('VOLVO')
    expect(familyOf("סיאט צ'כיה")).toBe('VAG')
    expect(familyOf('פולקסווגן-ספרד')).toBe('VAG')
    expect(familyOf('אאודי הונגריה')).toBe('VAG')
    expect(familyOf('ב מ וו גרמניה')).toBe('BMW')
    expect(familyOf('טויוטה טורקיה')).toBe('TOYOTA')
    expect(familyOf('פיאט')).toBe('FIAT')
  })
  it('folds Partly global_parts.brand values too', () => {
    expect(familyOf('PSA')).toBe('PSA')
    expect(familyOf('SKODA')).toBe('VAG')
    expect(familyOf('AUDI')).toBe('VAG')
    expect(familyOf('VOLVO')).toBe('VOLVO')
    expect(familyOf('MITSUBISHI')).toBe('MITSUBISHI')
  })
  it('is OTHER for the unknown, never a false PSA', () => {
    expect(familyOf('')).toBe('OTHER')
    expect(familyOf(null)).toBe('OTHER')
    expect(familyOf('יונדאי')).toBe('OTHER')
  })
})

describe('sharesNumbering', () => {
  it('is symmetric and only true for the two known pairs', () => {
    expect(sharesNumbering('PSA', 'FIAT')).toBe(true)
    expect(sharesNumbering('FIAT', 'PSA')).toBe(true)
    expect(sharesNumbering('MG', 'PSA')).toBe(true)
    expect(sharesNumbering('PSA', 'VOLVO')).toBe(false)
    expect(sharesNumbering('MG', 'VOLVO')).toBe(false)
  })
})

describe('familyFromSlug', () => {
  it('accepts the URL slugs and rejects anything else', () => {
    expect(familyFromSlug('volvo')).toBe('VOLVO')
    expect(familyFromSlug('VAG')).toBe('VAG')
    expect(familyFromSlug('other')).toBeNull()
    expect(familyFromSlug('hyundai')).toBeNull()
  })
})
