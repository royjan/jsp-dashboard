import { describe, expect, it } from 'vitest'
import {
  EMPTY_BLOCKLIST_FORM, blockingProviders, changedFields, entryToForm, filterEntries, formToPayload,
  validateBlocklistForm, type BlocklistEntry,
} from './vehicle-blocklist'

const entry = (over: Partial<BlocklistEntry> = {}): BlocklistEntry => ({
  id: 'a', vin_prefix: 'LSJWT', provider: 'all', reason: 'IM Motors IM5', active: true,
  created_by: 'seed', updated_by: 'seed', created_at: null, updated_at: null, ...over,
})

describe('validateBlocklistForm', () => {
  it('accepts a valid form and normalizes the prefix', () => {
    const f = { ...EMPTY_BLOCKLIST_FORM, vin_prefix: ' lsj wt ', reason: ' IM5 ' }
    expect(validateBlocklistForm(f)).toEqual([])
    expect(formToPayload(f)).toEqual({ vin_prefix: 'LSJWT', provider: 'all', reason: 'IM5', active: true })
  })
  it('requires prefix and reason', () => {
    expect(validateBlocklistForm(EMPTY_BLOCKLIST_FORM)).toEqual(['קידומת VIN היא שדה חובה', 'סיבה היא שדה חובה'])
  })
  it('rejects short, long, non-alphanumeric and I/O/Q prefixes', () => {
    for (const p of ['LS', 'A'.repeat(18), 'LS-J', 'לשג', 'LSJO1']) {
      expect(validateBlocklistForm({ ...EMPTY_BLOCKLIST_FORM, vin_prefix: p, reason: 'x' })).toHaveLength(1)
    }
  })
  it('rejects an unknown provider', () => {
    expect(validateBlocklistForm({ ...EMPTY_BLOCKLIST_FORM, vin_prefix: 'LSJWT', reason: 'x', provider: 'bmw' as never }))
      .toEqual(['ספק לא תקין'])
  })
})

describe('filterEntries', () => {
  const rows = [entry(), entry({ id: 'b', vin_prefix: 'LSJWH', provider: 'saic', active: false, reason: 'MG4 test' })]
  it('filters by provider and active', () => {
    expect(filterEntries(rows, { provider: 'saic' }).map(r => r.id)).toEqual(['b'])
    expect(filterEntries(rows, { active: true }).map(r => r.id)).toEqual(['a'])
    expect(filterEntries(rows, { active: false, provider: 'all' })).toEqual([])
  })
  it('free text matches prefix, reason, or a full VIN that starts with the prefix', () => {
    expect(filterEntries(rows, { q: 'mg4' }).map(r => r.id)).toEqual(['b'])
    expect(filterEntries(rows, { q: 'LSJWT4092TS020944' }).map(r => r.id)).toEqual(['a'])
  })
})

describe('edit helpers', () => {
  it('PATCH body carries only what changed', () => {
    const e = entry()
    expect(changedFields(e, entryToForm(e))).toEqual({})
    expect(changedFields(e, { ...entryToForm(e), active: false, reason: 'IM5 ' })).toEqual({ active: false, reason: 'IM5' })
  })
  it('blockingProviders lists the providers with a matching row', () => {
    expect(blockingProviders({ vin: 'X', fallback: false, providers: { psa: null, saic: entry(), qipei: entry() } }))
      .toEqual(['saic', 'qipei'])
  })
})
