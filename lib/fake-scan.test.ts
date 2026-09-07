import { describe, expect, it } from 'vitest'
import {
  classifySuspect, costAgeDays, DEFAULT_THRESHOLD_PCT, isActionable, isFakeStatus,
  overCostPct, STALE_COST_DAYS,
} from './fake-scan'

/** A cost date N days before `now`, as the API would send it. */
const NOW = new Date('2026-09-07T00:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()
const FRESH = daysAgo(30)
const STALE = daysAgo(STALE_COST_DAYS + 1)

describe('classifySuspect', () => {
  it('flags a competitor at or under our cost on a recent cost', () => {
    // The 1920RW case that started the rule: cost 346, competitor 390.
    expect(classifySuspect({ competitorPrice: 380, cost: 346, costDate: FRESH }, 10, NOW))
      .toBe('suspect')
  })

  it('treats the threshold as inclusive at its exact boundary', () => {
    // 110 is exactly cost * 1.10 — "at or below" has to include it, or the
    // documented 10% rule silently means "under 10%".
    expect(classifySuspect({ competitorPrice: 110, cost: 100, costDate: FRESH }, 10, NOW))
      .toBe('suspect')
    expect(classifySuspect({ competitorPrice: 110.01, cost: 100, costDate: FRESH }, 10, NOW))
      .toBe('none')
  })

  it('downgrades to stale_cost when the cost is too old to accuse anyone with', () => {
    // The whole reason this module differs from the portal's: 2755 of 4310
    // cached costs are older than this, so most raw hits are stale, not fake.
    expect(classifySuspect({ competitorPrice: 380, cost: 346, costDate: STALE }, 10, NOW))
      .toBe('stale_cost')
  })

  it('treats an unknown cost date as unusable, not as fresh', () => {
    expect(classifySuspect({ competitorPrice: 380, cost: 346, costDate: null }, 10, NOW))
      .toBe('stale_cost')
  })

  it('never re-judges an admin verdict, however the prices look', () => {
    // A row a human cleared must not come back as news, and a confirmed fake
    // must not be cleared by a price change.
    for (const verdict of ['confirmed', 'cleared'] as const) {
      expect(classifySuspect(
        { competitorPrice: 9999, cost: 1, costDate: FRESH, fakeStatus: verdict }, 10, NOW,
      )).toBe(verdict)
    }
  })

  it('returns none — never a suspicion — when there is no basis to judge', () => {
    // No cost is "we cannot tell", and it must not read as "priced fine"
    // either; `none` here means "not on the list", which is what the caller
    // does with it. A zero or negative price is not data.
    expect(classifySuspect({ competitorPrice: 380, cost: null, costDate: FRESH }, 10, NOW)).toBe('none')
    expect(classifySuspect({ competitorPrice: 380, cost: 0, costDate: FRESH }, 10, NOW)).toBe('none')
    expect(classifySuspect({ competitorPrice: null, cost: 346, costDate: FRESH }, 10, NOW)).toBe('none')
    expect(classifySuspect({ competitorPrice: -5, cost: 346, costDate: FRESH }, 10, NOW)).toBe('none')
  })

  it('clamps a nonsense threshold instead of trusting it', () => {
    // The threshold comes from a slider, but nothing stops a caller passing
    // junk; a NaN must not turn every row into a suspect.
    expect(classifySuspect({ competitorPrice: 200, cost: 100, costDate: FRESH }, NaN, NOW)).toBe('none')
    expect(classifySuspect({ competitorPrice: 200, cost: 100, costDate: FRESH }, -50, NOW)).toBe('none')
    expect(classifySuspect({ competitorPrice: 200, cost: 100, costDate: FRESH }, 500, NOW)).toBe('suspect')
  })

  it('defaults to the portal\'s own threshold so both apps flag the same rows', () => {
    expect(DEFAULT_THRESHOLD_PCT).toBe(10)
    expect(classifySuspect({ competitorPrice: 109, cost: 100, costDate: FRESH }, undefined, NOW))
      .toBe('suspect')
  })
})

describe('overCostPct', () => {
  it('is negative below cost and positive above it', () => {
    expect(overCostPct(80, 100)).toBeCloseTo(-20)
    expect(overCostPct(130, 100)).toBeCloseTo(30)
    expect(overCostPct(100, 100)).toBeCloseTo(0)
  })

  it('is null rather than 0 or Infinity when either side is missing', () => {
    // A missing cost rendered as 0% would sort among the healthy rows.
    expect(overCostPct(80, null)).toBeNull()
    expect(overCostPct(null, 100)).toBeNull()
    expect(overCostPct(80, 0)).toBeNull()
  })
})

describe('costAgeDays', () => {
  it('counts whole days back from now', () => {
    expect(costAgeDays(daysAgo(10), NOW)).toBe(10)
    expect(costAgeDays(new Date(NOW), NOW)).toBe(0)
  })

  it('is null for absent or unparseable dates', () => {
    expect(costAgeDays(null, NOW)).toBeNull()
    expect(costAgeDays(undefined, NOW)).toBeNull()
    expect(costAgeDays('not a date', NOW)).toBeNull()
  })
})

describe('verdict helpers', () => {
  it('puts only real accusations on the action list', () => {
    expect(isActionable('suspect')).toBe(true)
    expect(isActionable('confirmed')).toBe(true)
    // An undecidable row is not an accusation.
    expect(isActionable('stale_cost')).toBe(false)
    expect(isActionable('cleared')).toBe(false)
    expect(isActionable('none')).toBe(false)
  })

  it('recognises exactly the portal\'s statuses', () => {
    expect(isFakeStatus('suspect')).toBe(true)
    expect(isFakeStatus('nope')).toBe(false)
    expect(isFakeStatus(null)).toBe(false)
  })
})
