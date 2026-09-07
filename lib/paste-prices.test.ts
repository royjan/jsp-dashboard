import { describe, expect, it } from 'vitest'
import { normalizeCode, parsePastedMoney, parsePastedPrices } from './paste-prices'

describe('normalizeCode', () => {
  it('strips the separators people type and the ERP does not store', () => {
    // All three forms of the same part, as they arrive from Excel, a message
    // and a competitor sheet respectively.
    expect(normalizeCode('0249.E6')).toBe('0249E6')
    expect(normalizeCode('9824 4878 ZD')).toBe('98244878ZD')
    expect(normalizeCode('1606-4666-80')).toBe('1606466680')
  })

  it('drops the erp- prefix the portal uses for admin ids', () => {
    expect(normalizeCode('erp-1109AY')).toBe('1109AY')
    expect(normalizeCode('ERP-1109ay')).toBe('1109AY')
  })

  it('is empty for junk, so the caller can skip the line', () => {
    expect(normalizeCode('   ')).toBe('')
    expect(normalizeCode(null)).toBe('')
    expect(normalizeCode('---')).toBe('')
  })
})

describe('parsePastedMoney', () => {
  it('reads the currency forms that actually get pasted', () => {
    expect(parsePastedMoney('29.00 ₪')).toBe(29)
    expect(parsePastedMoney('1,022.50')).toBe(1022.5)
    expect(parsePastedMoney(' 416.40 ')).toBe(416.4)
  })

  it('rejects a non-price rather than coercing it to zero', () => {
    // 0 means "not quoted", never "free"; a header cell is not a price.
    expect(parsePastedMoney('0')).toBeNull()
    expect(parsePastedMoney('מחיר')).toBeNull()
    expect(parsePastedMoney('')).toBeNull()
    expect(parsePastedMoney(null)).toBeNull()
    expect(parsePastedMoney('9999999')).toBeNull() // past MAX_PRICE — a parse artefact
  })
})

describe('parsePastedPrices', () => {
  it('reads Excel TSV, message spacing and comma-separated lines alike', () => {
    const { rows, skipped } = parsePastedPrices(
      '1109AY\t17\n0249E6  52.60  מקורי\n9833351080, 38',
    )
    expect(skipped).toEqual([])
    expect(rows).toEqual([
      { rawCode: '1109AY', code: '1109AY', price: 17 },
      { rawCode: '0249E6', code: '0249E6', price: 52.6, note: 'מקורי' },
      { rawCode: '9833351080', code: '9833351080', price: 38 },
    ])
  })

  it('keeps a bad line out WITH a reason instead of dropping it silently', () => {
    // A paste that quietly arrives three rows short is the failure this
    // guards against: the preview has to be able to say what was lost.
    //
    // The two reasons are not interchangeable, and which one each line gets is
    // worth pinning down. A Hebrew header row normalises to an EMPTY code (the
    // comparison form keeps only A-Z0-9), so it is reported as a missing code,
    // not as a bad price. A bare number is the opposite: a plausible code with
    // nothing after it.
    const { rows, skipped } = parsePastedPrices('מק"ט\tמחיר\n1109AY\t17\n\t99')
    expect(rows).toHaveLength(1)
    expect(skipped).toEqual([
      { line: 1, text: 'מק"ט\tמחיר', reason: 'חסר מק"ט' },
      { line: 3, text: '99', reason: 'מחיר לא תקין' },
    ])
  })

  it('lets a corrected line below the original win', () => {
    // Re-pasting a fixed row under the wrong one is the common repair.
    const { rows } = parsePastedPrices('1109AY 17\n1109AY 19')
    expect(rows).toEqual([{ rawCode: '1109AY', code: '1109AY', price: 19 }])
  })

  it('matches codes across formatting differences within one paste', () => {
    const { rows } = parsePastedPrices('0249.E6\t50\n0249 E6\t60')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ code: '0249E6', price: 60 })
  })

  it('ignores blank lines and trailing whitespace, and survives empty input', () => {
    expect(parsePastedPrices('').rows).toEqual([])
    expect(parsePastedPrices('\n\n  \n').rows).toEqual([])
    expect(parsePastedPrices('\n1109AY 17\n\n').rows).toHaveLength(1)
  })

  it('keeps the raw code for display and the normalised one for lookup', () => {
    // The table shows what the user typed; the API is asked the bare form.
    const { rows } = parsePastedPrices('0249.E6\t50')
    expect(rows[0].rawCode).toBe('0249.E6')
    expect(rows[0].code).toBe('0249E6')
  })
})
