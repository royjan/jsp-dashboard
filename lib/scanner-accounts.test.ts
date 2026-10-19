import { describe, expect, it } from 'vitest'
import {
  applyChange,
  buildView,
  ChangeError,
  MAX_ACCOUNTS,
  onPremWrites,
  providerById,
  readAccounts,
  revealPassword,
  type Change,
} from './scanner-accounts'

const NOW = new Date('2026-10-19T18:00:00Z')
const legacy = (): Record<string, string> => ({
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
const psa = (v: Record<string, string>) => buildView(v).find((p) => p.id === 'psa')!
const apply = (v: Record<string, string>, change: Change, provider = 'psa') =>
  applyChange(v, provider, change, 'roy@jan.co.il', NOW).values
const list = (v: Record<string, string>) => readAccounts(v, providerById('psa')!).accounts

describe('reading', () => {
  it('derives the list from the old fixed keys until the first save', () => {
    const v = psa(legacy())
    expect(v.legacyOnly).toBe(true)
    expect(v.accounts.map((a) => [a.username, a.portal, a.enabled, a.usedNow])).toEqual([
      ['db31832', 'dealer', true, true],
      ['db40000', 'dealer', true, true],
      ['APJSP', 'public', true, true],
    ])
  })

  it('never carries a password to the browser', () => {
    const v = apply(legacy(), { op: 'add', username: 'db5', password: 'p5' })
    expect(JSON.stringify(buildView(v))).not.toMatch(/"p1"|"p2"|"p3"|"p5"|"plp"/)
  })

  it('a repeat of an earlier login is flagged and never used', () => {
    const v = psa({ ...legacy(), PSA_USERNAME_FALLBACK: 'db31832' })
    expect(v.accounts[1]).toMatchObject({ sameAs: 'a1', usedNow: false })
    expect(v.accounts[2].usedNow).toBe(true)
  })
})

describe('changes', () => {
  it('the first save migrates to the list and keeps the old keys in step', () => {
    const v = apply(legacy(), { op: 'update', id: 'a2', password: 'p2b' })
    expect(list(v).map((a) => [a.id, a.username, a.password])).toEqual([
      ['a1', 'db31832', 'p1'], ['a2', 'db40000', 'p2b'], ['a3', 'APJSP', 'p3'],
    ])
    expect(v.PSA_PASSWORD_FALLBACK).toBe('p2b')
    expect(v.OPENAI_API_KEY).toBe('untouched')
    expect(psa(v).legacyOnly).toBe(false)
  })

  it('adds up to a primary and five fallbacks', () => {
    let v = legacy()
    for (let i = 4; i <= MAX_ACCOUNTS; i++) v = apply(v, { op: 'add', username: `db${i}`, password: `p${i}` })
    expect(list(v)).toHaveLength(MAX_ACCOUNTS)
    expect(() => apply(v, { op: 'add', username: 'one-too-many', password: 'x' })).toThrow(/at most 6/)
  })

  it('refuses a duplicate login, but the same username on the other portal is fine', () => {
    expect(() => apply(legacy(), { op: 'add', username: 'DB31832', password: 'x' })).toThrow(/already/)
    expect(list(apply(legacy(), { op: 'add', username: 'db31832', password: 'x', portal: 'public' }))).toHaveLength(4)
  })

  it('moving an account to the top makes it the primary in the old keys too', () => {
    const v = apply(legacy(), { op: 'move', id: 'a2', to: 0 })
    expect(list(v).map((a) => a.id)).toEqual(['a2', 'a1', 'a3'])
    expect([v.PSA_USERNAME, v.PSA_PASSWORD, v.PSA_USERNAME_FALLBACK]).toEqual(['db40000', 'p2', 'db31832'])
  })

  it('disabling the primary promotes the next dealer in the old keys; the list keeps it', () => {
    const v = apply(legacy(), { op: 'toggle', id: 'a1', enabled: false })
    expect(v.PSA_USERNAME).toBe('db40000')
    expect(v.PSA_USERNAME_FALLBACK).toBeUndefined()
    expect(list(v)[0]).toMatchObject({ username: 'db31832', enabled: false })
  })

  it('deleting the public account removes it from the old keys', () => {
    const v = apply(legacy(), { op: 'delete', id: 'a3' })
    expect(list(v)).toHaveLength(2)
    expect(v.PSA_USERNAME_PUBLIC).toBeUndefined()
    expect(v.PSA_PASSWORD_PUBLIC).toBeUndefined()
  })

  it('will not leave a provider without a usable dealer account', () => {
    const one = apply(legacy(), { op: 'delete', id: 'a2' })
    expect(() => apply(one, { op: 'delete', id: 'a1' })).toThrow(/at least one enabled dealer/)
    expect(() => apply(one, { op: 'toggle', id: 'a1', enabled: false })).toThrow(ChangeError)
    expect(() => apply(legacy(), { op: 'delete', id: 'a1' }, 'partslink')).toThrow(/at least one enabled account/)
  })

  it('cleans up keys parked by the earlier on/off version', () => {
    const parked = { ...legacy(), PSA_USERNAME_FALLBACK__OFF: 'db40000', PSA_PASSWORD_FALLBACK__OFF: 'p2' }
    delete (parked as Record<string, string>).PSA_USERNAME_FALLBACK
    delete (parked as Record<string, string>).PSA_PASSWORD_FALLBACK
    expect(psa(parked).accounts[1]).toMatchObject({ enabled: false, username: 'db40000' })
    const v = apply(parked, { op: 'toggle', id: 'a2', enabled: true })
    expect(v.PSA_USERNAME_FALLBACK__OFF).toBeUndefined()
    expect(v.PSA_USERNAME_FALLBACK).toBe('db40000')
  })

  it('stamps who changed an account, and refuses read-only providers', () => {
    const v = apply(legacy(), { op: 'update', id: 'a1', password: 'p1b' })
    expect(list(v)[0]).toMatchObject({ password: 'p1b', changedAt: NOW.toISOString(), changedBy: 'roy@jan.co.il' })
    expect(() => apply(legacy(), { op: 'add', username: 'x', password: 'y' }, 'tivtaam')).toThrow(/not editable/)
  })

  it('records when each provider last changed, deletions included', () => {
    const v = apply(legacy(), { op: 'delete', id: 'a3' })
    expect(psa(v).changedAt).toBe(NOW.toISOString())
    expect(buildView(v).find((p) => p.id === 'saic')!.changedAt).toBeUndefined()
  })

  it('does not mutate its input', () => {
    const v = legacy()
    apply(v, { op: 'move', id: 'a3', to: 0 })
    expect(v).toEqual(legacy())
  })

  it('a provider whose scanner reads only the old keys shows which accounts it really uses', () => {
    const v = apply(legacy(), { op: 'add', username: 'pl2', password: 'x' }, 'partslink')
    const pl = buildView(v).find((p) => p.id === 'partslink')!
    expect(pl.accounts.map((a) => [a.username, a.usedNow])).toEqual([['pl', true], ['pl2', false]])
  })
})

describe('onPremWrites', () => {
  it('writes the list and keeps the per-role Redis keys portal-pilot reads in step', () => {
    const p = providerById('psa')!
    const v = apply(apply(legacy(), { op: 'add', username: 'db5', password: 'p5' }), { op: 'move', id: 'a4', to: 1 })
    const w = onPremWrites(p, readAccounts(v, p).accounts)
    const creds = (k: string) => JSON.parse(w[`portal-pilot:creds:${k}`] as string)
    expect(creds('psa')).toEqual({ username: 'db31832', password: 'p1' })
    expect(creds('psa_worker')).toEqual({ username: 'db31832', password: 'p1' })
    expect(creds('psa_fallback')).toEqual({ username: 'db5', password: 'p5' })
    expect(creds('psa_public')).toEqual({ username: 'APJSP', password: 'p3' })
    const list = JSON.parse(w['portal-pilot:creds:psa_accounts'] as string)
    expect(list.map((a: { username: string }) => a.username)).toEqual(['db31832', 'db5', 'db40000', 'APJSP'])
    expect(list[0]).not.toHaveProperty('changedBy')
  })

  it('deletes a role key when no account fills it, and does nothing for providers without on-prem users', () => {
    const p = providerById('psa')!
    const v = apply(apply(legacy(), { op: 'delete', id: 'a2' }), { op: 'delete', id: 'a3' })
    const w = onPremWrites(p, readAccounts(v, p).accounts)
    expect(w['portal-pilot:creds:psa_fallback']).toBeNull()
    expect(w['portal-pilot:creds:psa_public']).toBeNull()
    expect(onPremWrites(providerById('saic')!, [])).toEqual({})
  })
})

describe('revealPassword', () => {
  it('returns one account password by id', () => {
    expect(revealPassword(legacy(), 'psa', 'a3')).toBe('p3')
  })
})
