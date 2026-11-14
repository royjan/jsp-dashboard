import { describe, expect, it } from 'vitest'
import {
  chatHref, countByKind, customerCodeVariants, dayKey, deliveryEvents, diegoEvents, documentEvents,
  filterTimeline, groupByDay, heldEvents, mergeTimeline, receiptEvents, type TimelineEvent,
} from './customer-timeline'

const ev = (over: Partial<TimelineEvent> & { id: string; at: string }): TimelineEvent => ({
  kind: 'request', hasTime: !/^\d{4}-\d{2}-\d{2}$/.test(over.at), ...over,
})

describe('dayKey', () => {
  it('keeps a bare date as is', () => {
    expect(dayKey('2026-11-13')).toBe('2026-11-13')
  })
  it('buckets a timestamp on the Israel day, not the UTC day', () => {
    // 23:30Z on the 12th is 01:30 on the 13th in Israel (UTC+2 in November).
    expect(dayKey('2026-11-12T23:30:00Z')).toBe('2026-11-13')
  })
  it('returns empty for garbage', () => {
    expect(dayKey('not a date')).toBe('')
  })
})

describe('mergeTimeline', () => {
  it('sorts newest day first, timed before day-only, day-only by number desc', () => {
    const merged = mergeTimeline(
      [ev({ id: 'a', at: '2026-11-12T08:00:00Z' }), ev({ id: 'b', at: '2026-11-13T06:00:00Z' })],
      [
        ev({ id: 'q1', kind: 'quote', at: '2026-11-13', number: '342248' }),
        ev({ id: 'q2', kind: 'quote', at: '2026-11-13', number: '342270' }),
        ev({ id: 'c', at: '2026-11-13T09:00:00Z' }),
      ],
    )
    expect(merged.map((e) => e.id)).toEqual(['c', 'b', 'q2', 'q1', 'a'])
  })

  it('drops duplicate ids and undated events', () => {
    const merged = mergeTimeline(
      [ev({ id: 'x', at: '2026-11-13T09:00:00Z' }), ev({ id: 'bad', at: '' })],
      [ev({ id: 'x', at: '2026-11-13T09:00:00Z' })],
    )
    expect(merged.map((e) => e.id)).toEqual(['x'])
  })
})

describe('groupByDay / filter / count', () => {
  const events = mergeTimeline([
    ev({ id: 'r', at: '2026-11-13T06:00:00Z' }),
    ev({ id: 'i', kind: 'invoice', at: '2026-11-13', number: '1' }),
    ev({ id: 'p', kind: 'payment', at: '2026-11-10', number: '2' }),
  ])

  it('groups consecutive events by day in order', () => {
    const days = groupByDay(events)
    expect(days.map((d) => d.day)).toEqual(['2026-11-13', '2026-11-10'])
    expect(days[0].events.map((e) => e.id)).toEqual(['r', 'i'])
  })

  it('filters by kind and counts every filter', () => {
    expect(filterTimeline(events, 'payment').map((e) => e.id)).toEqual(['p'])
    expect(filterTimeline(events, 'all')).toHaveLength(3)
    const c = countByKind(events)
    expect(c).toMatchObject({ all: 3, request: 1, invoice: 1, payment: 1, quote: 0, held: 0, delivery: 0 })
  })
})

describe('customerCodeVariants', () => {
  it('lists every padding width of the bare code', () => {
    const v = customerCodeVariants('0000031956')
    expect(v).toContain('31956')
    expect(v).toContain('031956')
    expect(v).toContain('0000031956')
    expect(v).toHaveLength(6)
  })
  it('covers the delivery app 5-wide walk-in form', () => {
    expect(customerCodeVariants('0000000099')).toContain('00099')
  })
})

describe('source normalisers', () => {
  it('maps FINAPI documents: 31 → quote, others → invoice, gross amount, document link', () => {
    const out = documentEvents([
      { doc_number: '342270', format: '31', doc_date: '2026-11-13', total: 1696.67, grand_total: 2002.1 },
      { doc_number: '128489', format: '11', doc_date: '2026-11-12', total: 100 },
      { doc_number: '', format: '11', doc_date: '2026-11-12' },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ kind: 'quote', amount: 2002.1, hasTime: false, href: '/documents/31/342270?year=2026' })
    expect(out[1]).toMatchObject({ kind: 'invoice', subtype: '11', amount: 100 })
  })

  it('maps receipts with string amounts', () => {
    const out = receiptEvents([{ order_num: 'K01034714', payment_date: '2026-06-17', amount: '34032.00' }])
    expect(out[0]).toMatchObject({ kind: 'payment', number: 'K01034714', amount: 34032, at: '2026-06-17' })
  })

  it('groups a lookup burst into one request and hides a session already shown', () => {
    const car = { id: 245, plate: '30978202', vin: 'VF3YCBNFA12P70667', label: 'BOXER' }
    const out = diegoEvents({
      cars: [car],
      jobs: [
        { rid: 'w1', car_id: 245, term: 'מסנן שמן', state: 'done', created_at: '2026-11-11T08:00:00Z', user_name: 'roy' },
        { rid: 'w2', car_id: 245, term: 'מסנן אוויר', state: 'miss', created_at: '2026-11-11T08:01:00Z', user_name: 'roy' },
        { rid: 'w3', car_id: 245, term: 'רפידות', state: 'done', created_at: '2026-11-11T12:00:00Z', user_name: 'roy' },
      ],
      ingress: [{ rid: 'in1', channel: 'wa', chat_name: 'ע מ 31956 בני', text: 'מכסה מילוי שמן', car_id: 245, created_at: '2026-11-11T09:00:00Z', status: 'answered' }],
      sessions: [
        { id: 21, car_id: 245, channel: 'wa', who: 'בני', started_at: '2026-11-11T09:00:00Z', last_at: '2026-11-11T09:05:00Z' },
        { id: 22, car_id: 245, channel: 'wa', who: 'בני', started_at: '2026-11-12T09:00:00Z', last_at: null },
      ],
    })
    const lookups = out.filter((e) => e.subtype === 'lookup')
    expect(lookups).toHaveLength(2)
    expect(lookups[0]).toMatchObject({ text: 'מסנן שמן · מסנן אוויר', status: 'partial', plate: '30978202' })
    expect(lookups[0].href).toBe('https://chat.jan.parts/car/VF3YCBNFA12P70667')
    expect(out.filter((e) => e.subtype === 'session').map((e) => e.id)).toEqual(['diego:session:22'])
  })

  it('links a no-car conversation by id, not by its synthetic VIN', () => {
    expect(chatHref({ id: 327, plate: null, vin: 'Q-d1d716d97832', label: null }))
      .toBe('https://chat.jan.parts/conversation/car=327')
  })

  it('uses the delivery’s latest state time', () => {
    const [d] = deliveryEvents([{ id: 'abc', status: 'delivered', assignedAt: '2026-11-13T07:41:00Z', deliveredAt: '2026-11-13T07:52:00Z' }])
    expect(d).toMatchObject({ kind: 'delivery', subtype: 'delivered', at: '2026-11-13T07:52:00Z', href: '/deliveries/abc' })
  })

  it('derives held arrival state from the lines', () => {
    const out = heldEvents([
      { id: 1, supplier: 'Comet', created_at: '2026-11-01T08:00:00Z', arrived_at: '2026-11-05T08:00:00Z',
        line_items: [{ item_id: 'A1', description: 'פילטר', quantity: 2, qty_arrived: 2 }] },
      { id: 2, supplier: 'Comet', created_at: '2026-11-02T08:00:00Z',
        line_items: [{ item_id: 'B1', quantity: 2, qty_arrived: 1 }] },
    ])
    expect(out.map((e) => [e.id, e.subtype, e.status])).toEqual([
      ['held:1', 'ordered', 'arrived'],
      ['held:1:arrived', 'arrived', 'arrived'],
      ['held:2', 'ordered', 'partial'],
    ])
    expect(out[0].text).toBe('פילטר ×2')
  })
})
