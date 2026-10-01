import { forward, idPath, readBody, requireAdmin, requireReader } from '@/lib/vehicle-twins-proxy'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** GET → {twin, log}. PUT (full) / PATCH (partial) → {twin}. DELETE → {deleted}. */
export async function GET(_req: Request, { params }: Ctx) {
  const gate = await requireReader()
  if ('res' in gate) return gate.res
  return forward(idPath((await params).id))
}

async function write(method: 'PUT' | 'PATCH', req: Request, { params }: Ctx) {
  const gate = await requireAdmin()
  if ('res' in gate) return gate.res
  const parsed = await readBody(req)
  if ('res' in parsed) return parsed.res
  return forward(idPath((await params).id), { method, body: parsed.body ?? {}, actingUser: gate.viewer.email })
}

export const PUT = (req: Request, ctx: Ctx) => write('PUT', req, ctx)
export const PATCH = (req: Request, ctx: Ctx) => write('PATCH', req, ctx)

export async function DELETE(_req: Request, { params }: Ctx) {
  const gate = await requireAdmin()
  if ('res' in gate) return gate.res
  return forward(idPath((await params).id), { method: 'DELETE', actingUser: gate.viewer.email })
}
