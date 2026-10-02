import { forward, readBody, requireAdmin, requireReader } from '@/lib/vehicle-twins-proxy'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

const idPath = (id: string) => `/api/vehicle-blocklist/${encodeURIComponent(id)}`

/** GET → {entry, log}. PATCH (partial) → {entry}. DELETE → {deleted}. Writes: dashboard admins only. */
export async function GET(_req: Request, { params }: Ctx) {
  const gate = await requireReader()
  if ('res' in gate) return gate.res
  return forward(idPath((await params).id))
}

export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireAdmin()
  if ('res' in gate) return gate.res
  const parsed = await readBody(req)
  if ('res' in parsed) return parsed.res
  return forward(idPath((await params).id), { method: 'PATCH', body: parsed.body ?? {}, actingUser: gate.viewer.email })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const gate = await requireAdmin()
  if ('res' in gate) return gate.res
  return forward(idPath((await params).id), { method: 'DELETE', actingUser: gate.viewer.email })
}
