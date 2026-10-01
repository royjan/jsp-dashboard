import { describe, expect, it } from 'vitest'
import {
  EMPTY_FORM, apiErrorLines, filterTwins, formToPayload, formatYears, isTwinAdmin, listOf, overlapPercent,
  parseAdminList, twinToForm, validateForm, type VehicleTwin,
} from './vehicle-twins'

const twin = (over: Partial<VehicleTwin> = {}): VehicleTwin => ({
  id: 1, market: 'IL', brand: 'Fiat', model: 'Doblo', model_codes: ['K9'], vin_prefixes: ['ZFAEF'],
  vin_pattern: null, year_from: 2022, year_to: null, powertrain: 'diesel', twin_brand: 'Citroen',
  twin_model: 'Berlingo', twin_catalogue: 'PSA', twin_catalogue_ref: 'K9-2018', twin_vin_prefixes: null,
  twin_project_id: null, relation: 'rebadge', overlap_pct: 92.4, overlap_detail: null, source: 'manual',
  confidence: 'high', notes: null, created_by: 'roy@jan.co.il', updated_by: null, created_at: null, updated_at: null,
  ...over,
})

describe('admin gate', () => {
  it('defaults to roy and avi when unset', () => {
    expect(parseAdminList(undefined)).toEqual(['roy@jan.co.il', 'avi@jan.co.il'])
    expect(parseAdminList('  ')).toEqual(['roy@jan.co.il', 'avi@jan.co.il'])
  })
  it('parses a comma list and compares case-insensitively', () => {
    const admins = parseAdminList('Roy@Jan.co.il, x@jan.co.il')
    expect(isTwinAdmin('ROY@jan.co.il', admins)).toBe(true)
    expect(isTwinAdmin('avi@jan.co.il', admins)).toBe(false)
    expect(isTwinAdmin(null, admins)).toBe(false)
  })
})

describe('display helpers', () => {
  it('formats year ranges', () => {
    expect(formatYears(2016, 2023)).toBe('2016–2023')
    expect(formatYears(2020, 2020)).toBe('2020')
    expect(formatYears(2022, null)).toBe('2022+')
    expect(formatYears(null, 2019)).toBe('–2019')
    expect(formatYears(null, null)).toBe('')
  })
  it('reads overlap as a percent whether stored 0–1 or 0–100', () => {
    expect(overlapPercent(0.874)).toBe(87.4)
    expect(overlapPercent(87.44)).toBe(87.4)
    expect(overlapPercent('91')).toBe(91)
    expect(overlapPercent(null)).toBeNull()
    expect(overlapPercent('x')).toBeNull()
  })
  it('lists arrays and comma strings alike', () => {
    expect(listOf(['a', ' b '])).toEqual(['a', 'b'])
    expect(listOf('a, b c')).toEqual(['a', 'b', 'c'])
    expect(listOf(null)).toEqual([])
  })
})

describe('filterTwins', () => {
  const rows = [twin(), twin({ id: 2, brand: 'Opel', model: 'Combo', relation: 'platform', confidence: 'low' })]
  it('filters by brand, relation and confidence', () => {
    expect(filterTwins(rows, { brand: 'opel' }).map(r => r.id)).toEqual([2])
    expect(filterTwins(rows, { relation: 'rebadge' }).map(r => r.id)).toEqual([1])
    expect(filterTwins(rows, { confidence: 'low' }).map(r => r.id)).toEqual([2])
  })
  it('free text reaches catalogue refs and VIN prefixes', () => {
    expect(filterTwins(rows, { q: 'k9-2018' })).toHaveLength(2)
    expect(filterTwins(rows, { q: 'zfaef' })).toHaveLength(2)
    expect(filterTwins(rows, { q: 'combo' }).map(r => r.id)).toEqual([2])
  })
})

describe('form <-> payload', () => {
  it('round-trips a twin and builds typed JSON', () => {
    const p = formToPayload(twinToForm(twin()))
    expect(p.year_from).toBe(2022)
    expect(p.year_to).toBeNull()
    expect(p.vin_prefixes).toEqual(['ZFAEF'])
    expect(p.twin_vin_prefixes).toEqual([])
    expect(p.notes).toBeNull()
    expect(p.relation).toBe('rebadge')
  })
  it('validates required fields and year order', () => {
    expect(validateForm(EMPTY_FORM).length).toBeGreaterThanOrEqual(5)
    const ok = twinToForm(twin())
    expect(validateForm(ok)).toEqual([])
    expect(validateForm({ ...ok, year_from: '2024', year_to: '2020' })).toContain('שנת התחלה אחרי שנת סיום')
    expect(validateForm({ ...ok, powertrain: 'steam' })).toContain('הנעה לא חוקית')
  })
})

describe('apiErrorLines', () => {
  it('lists 400 validation errors as given', () => {
    expect(apiErrorLines(400, { errors: ['brand is required', { field: 'year_to', message: 'bad' }] }))
      .toEqual(['brand is required', 'year_to: bad'])
  })
  it('names 409 / 403 / 422', () => {
    expect(apiErrorLines(409, { error: 'duplicate key' })).toEqual(['כבר קיימת רשומה עם אותו מפתח', 'duplicate key'])
    expect(apiErrorLines(403, {})).toEqual(['אין הרשאת עריכה'])
    expect(apiErrorLines(422, { missing: ['subject', 'twin'] })[1]).toContain('subject, twin')
  })
})
