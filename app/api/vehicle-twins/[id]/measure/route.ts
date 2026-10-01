import { forward, idPath, readBody, requireAdmin } from '@/lib/vehicle-twins-proxy'

export const dynamic = 'force-dynamic'
// Measuring compares two scanned catalogues; give it room.
export const maxDuration = 120

/** POST → {twin, overlap, decision}; 422 {missing} when a side has no scanned project. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireAdmin()
  if ('res' in gate) return gate.res
  const parsed = await readBody(req)
  if ('res' in parsed) return parsed.res
  return forward(`${idPath((await params).id)}/measure`, {
    method: 'POST', body: parsed.body ?? {}, actingUser: gate.viewer.email, timeoutMs: 115_000,
  })
}
