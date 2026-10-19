import { describe, expect, it } from 'vitest'
import { applyChange, buildView, ChangeError, META_KEY, revealPassword } from './scanner-accounts'

const NOW = new Date('2026-10-19T18:00:00Z')
const base = (): Record<string, string> => ({
  PSA_USERNAME: 'db31832',
  PSA_PASSWORD: 'p1',
  PSA_USERNAME_FALLBACK: 'db40000',
  PSA_PASSWORD_FALLBACK: 'p2',
  PSA_USERNAME_PUBLIC: 'APJSP',
  PSA_PASSWORD_PUBLIC: 'p3',
  PARTSLINK_USERNAME: 'pl',
  PARTSLINK_PASSWORD: 'plp',
  OPENAI_API_KEY: 'untouched',
})
const psa = (values: Record<string, string>) => buildView(values).find((p) => p.id === 'psa')!

describe('buildView', () => {
  it('never carries a password to the browser', () => {
    expect(JSON.stringify(buildView(base()))).not.toMatch(/"p1"|"p2"|"p3"|"plp"/)
  })

  it('shows the PSA ladder in order with every rung active', () => {
    const v = psa(base())
    expect(v.rungs.map((r) => [r.id, r.username, r.active, r.hasPassword])).toEqual([
      ['primary', 'db31832', true, true],
      ['fallback', 'db40000', true, true],
      ['public', 'APJSP', true, true],
    ])
  })

  it('a fallback with the same username as the primary is never reached', () => {
    const v = psa({ ...base(), PSA_USERNAME_FALLBACK: 'db31832' })
    expect(v.rungs[1]).toMatchObject({ active: false, sameAs: 'primary' })
    expect(v.rungs[2].active).toBe(true) // the public portal is a different kind
  })

  it('a rung with a missing password is not active (the scanner skips it)', () => {
    const v = psa({ ...base(), PSA_PASSWORD_FALLBACK: '' })
    expect(v.rungs[1]).toMatchObject({ active: false, hasPassword: false, parked: false })
  })
})

describe('applyChange', () => {
  it('switching a rung off parks its keys so the scanner sees nothing, and back on restores them', () => {
    const off = applyChange(base(), 'psa', { op: 'toggle', rung: 'fallback', enabled: false }, 'roy@jan.co.il', NOW).values
    expect(off.PSA_USERNAME_FALLBACK).toBeUndefined()
    expect(off.PSA_PASSWORD_FALLBACK).toBeUndefined()
    expect(off.PSA_USERNAME_FALLBACK__OFF).toBe('db40000')
    expect(psa(off).rungs[1]).toMatchObject({ active: false, parked: true, username: 'db40000', hasPassword: true })

    const on = applyChange(off, 'psa', { op: 'toggle', rung: 'fallback', enabled: true }, 'roy@jan.co.il', NOW).values
    expect(on.PSA_USERNAME_FALLBACK).toBe('db40000')
    expect(on.PSA_PASSWORD_FALLBACK).toBe('p2')
    expect(on.PSA_USERNAME_FALLBACK__OFF).toBeUndefined()
    expect(psa(on).rungs[1].active).toBe(true)
  })

  it('the primary account cannot be switched off', () => {
    expect(() => applyChange(base(), 'psa', { op: 'toggle', rung: 'primary', enabled: false }, 'x', NOW)).toThrow(ChangeError)
  })

  it('editing a parked rung edits the parked copy, so it stays off', () => {
    const off = applyChange(base(), 'psa', { op: 'toggle', rung: 'public', enabled: false }, 'x', NOW).values
    const edited = applyChange(off, 'psa', { op: 'set', rung: 'public', password: 'new' }, 'x', NOW).values
    expect(edited.PSA_PASSWORD_PUBLIC).toBeUndefined()
    expect(edited.PSA_PASSWORD_PUBLIC__OFF).toBe('new')
  })

  it('swap exchanges the two dealer accounts and leaves the public portal alone', () => {
    const v = applyChange(base(), 'psa', { op: 'swap', a: 'primary', b: 'fallback' }, 'x', NOW).values
    expect([v.PSA_USERNAME, v.PSA_PASSWORD, v.PSA_USERNAME_FALLBACK, v.PSA_PASSWORD_FALLBACK]).toEqual(['db40000', 'p2', 'db31832', 'p1'])
    expect(v.PSA_USERNAME_PUBLIC).toBe('APJSP')
    expect(() => applyChange(base(), 'psa', { op: 'swap', a: 'primary', b: 'public' }, 'x', NOW)).toThrow(/same kind/)
  })

  it('stamps who changed which account, and touches nothing outside the provider', () => {
    const { values, touched } = applyChange(base(), 'psa', { op: 'set', rung: 'fallback', password: 'p9' }, 'roy@jan.co.il', NOW)
    expect(touched.sort()).toEqual([META_KEY, 'PSA_PASSWORD_FALLBACK'].sort())
    expect(values.OPENAI_API_KEY).toBe('untouched')
    expect(psa(values).rungs[1].meta).toEqual({ changedAt: NOW.toISOString(), changedBy: 'roy@jan.co.il' })
  })

  it('refuses empty values and read-only providers', () => {
    expect(() => applyChange(base(), 'psa', { op: 'set', rung: 'primary', password: '' }, 'x', NOW)).toThrow(/empty/)
    expect(() => applyChange(base(), 'psa', { op: 'set', rung: 'primary', username: '  ' }, 'x', NOW)).toThrow(/empty/)
    expect(() => applyChange(base(), 'tivtaam', { op: 'set', rung: 'primary', password: 'x' }, 'x', NOW)).toThrow(/not editable/)
  })

  it('does not mutate its input', () => {
    const v = base()
    applyChange(v, 'psa', { op: 'toggle', rung: 'fallback', enabled: false }, 'x', NOW)
    expect(v).toEqual(base())
  })
})

describe('revealPassword', () => {
  it('finds a parked password too', () => {
    const off = applyChange(base(), 'psa', { op: 'toggle', rung: 'fallback', enabled: false }, 'x', NOW).values
    expect(revealPassword(off, 'psa', 'fallback')).toBe('p2')
  })
})
