import { beforeEach, describe, expect, it, vi } from 'vitest'

/* The /api/vehicle-blocklist proxy: reads need a session, writes a dashboard admin, and the
   admin's email goes to Partly as X-Acting-User. */
const m = vi.hoisted(() => ({
  viewer: { email: null as string | null, canEdit: false, authOn: true },
  calls: [] as Array<{ path: string; init: Record<string, unknown> }>,
}))
vi.mock('@/lib/partly-internal', () => ({
  currentViewer: async () => m.viewer,
  partlyFetch: async (path: string, init: Record<string, unknown> = {}) => {
    m.calls.push({ path, init })
    return { status: 200, body: { entries: [], count: 0 } }
  },
}))

import * as list from '@/app/api/vehicle-blocklist/route'
import * as one from '@/app/api/vehicle-blocklist/[id]/route'

const ctx = { params: Promise.resolve({ id: 'abc' }) }
const post = (body: unknown) => new Request('http://d/api/vehicle-blocklist', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  m.viewer = { email: null, canEdit: false, authOn: true }
  m.calls = []
})

describe('vehicle-blocklist proxy', () => {
  it('401 for an anonymous read or write', async () => {
    expect((await list.GET(new Request('http://d/api/vehicle-blocklist'))).status).toBe(401)
    expect((await list.POST(post({}))).status).toBe(401)
    expect(m.calls).toHaveLength(0)
  })
  it('a signed-in non-admin can read (viewer.canEdit false) but not write', async () => {
    m.viewer = { email: 'clerk@jan.co.il', canEdit: false, authOn: true }
    const r = await list.GET(new Request('http://d/api/vehicle-blocklist'))
    expect(await r.json()).toMatchObject({ count: 0, viewer: { email: 'clerk@jan.co.il', canEdit: false } })
    expect((await one.PATCH(new Request('http://d/x', { method: 'PATCH', body: '{}' }), ctx)).status).toBe(403)
    expect((await one.DELETE(new Request('http://d/x', { method: 'DELETE' }), ctx)).status).toBe(403)
  })
  it('passes ?vin= through and sends admin writes with X-Acting-User', async () => {
    m.viewer = { email: 'avi@jan.co.il', canEdit: true, authOn: true }
    await list.GET(new Request('http://d/api/vehicle-blocklist?vin=LSJWT4092TS020944'))
    expect(m.calls[0].path).toBe('/api/vehicle-blocklist?vin=LSJWT4092TS020944')
    await list.POST(post({ vin_prefix: 'LSJWT', provider: 'all', reason: 'x' }))
    expect(m.calls[1]).toMatchObject({ path: '/api/vehicle-blocklist', init: { method: 'POST', actingUser: 'avi@jan.co.il' } })
    await one.PATCH(new Request('http://d/x', { method: 'PATCH', body: '{"active":false}' }), ctx)
    expect(m.calls[2]).toMatchObject({ path: '/api/vehicle-blocklist/abc', init: { method: 'PATCH', body: { active: false }, actingUser: 'avi@jan.co.il' } })
    await one.DELETE(new Request('http://d/x', { method: 'DELETE' }), ctx)
    expect(m.calls[3]).toMatchObject({ path: '/api/vehicle-blocklist/abc', init: { method: 'DELETE', actingUser: 'avi@jan.co.il' } })
  })
})
