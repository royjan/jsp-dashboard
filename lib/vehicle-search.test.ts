import { describe, expect, it } from 'vitest'
import { brandHay, fold, makeMatcher, swapLayout } from './vehicle-search'

const hit = (q: string, hay: string) => makeMatcher(q)!(fold(hay))

describe('vehicle search', () => {
  it('finds a Hebrew brand by its English name', () => {
    expect(hit('tesla', brandHay('טסלה'))).toBe(true)
    expect(hit('Peugeot', brandHay("פיג'ו"))).toBe(true)
    expect(hit('bmw', brandHay('ב מ וו'))).toBe(true)
  })

  it('ignores vowel letters and apostrophes in Hebrew spelling', () => {
    for (const q of ['פגו', 'פיגו', "פיג'ו", 'פיג׳ו', 'פג׳ו']) expect(hit(q, "פיג'ו"), q).toBe(true)
    expect(hit('דאציה', "דאצ'יה")).toBe(true)
  })

  it('reads a query typed on the wrong keyboard layout', () => {
    expect(swapLayout('tesla')).toBe('אקדךש')
    expect(hit('אקדךש', brandHay('טסלה'))).toBe(true) // "tesla" on a Hebrew layout
    expect(hit('yuhuyv', 'טויוטה')).toBe(true)       // "טויוטה" on an English layout
  })

  it('needs every word', () => {
    expect(hit('tesla model 3', `${brandHay('טסלה')} MODEL 3`)).toBe(true)
    expect(hit('tesla model y', `${brandHay('טסלה')} MODEL 3`)).toBe(false)
  })

  it('matches Latin from the start of a word only', () => {
    expect(hit('mg', brandHay('מ.ג'))).toBe(true)
    expect(hit('mg', `${brandHay('מרצדס')} S63 AMG`)).toBe(false)
    expect(hit('208', `${brandHay("פיג'ו")} 2008`)).toBe(false)
  })

  it('does not match unrelated brands', () => {
    expect(hit('tesla', brandHay('טויוטה'))).toBe(false)
    expect(hit('פגו', brandHay('פורד'))).toBe(false)
  })

  it('empty query matches everything', () => {
    expect(makeMatcher('   ')).toBeNull()
  })
})
