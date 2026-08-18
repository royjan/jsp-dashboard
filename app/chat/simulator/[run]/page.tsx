/**
 * Deep link to one simulator run.
 *
 *   /chat/simulator/run_id=sim-20260818-101612-5989      <- the shape people actually paste
 *   /chat/simulator/sim-20260818-101612-5989             <- the bare id works too
 *
 * Both land on the simulator with that run selected. The page itself reads `?run=`, so this
 * route only normalises the path form into it rather than duplicating the page — one
 * implementation, one place for the loading and error behaviour to live.
 */
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function SimulatorRunPage(
  { params }: { params: Promise<{ run: string }> },
) {
  const { run } = await params
  // Tolerate `run_id=`, `run=`, and a bare id, each possibly URL-encoded. A pasted link is
  // the least controlled input this app takes; the only thing that must not happen is
  // forwarding junk into the query string, so anything unrecognised falls back to the
  // newest run rather than 404ing on a link someone shared in a chat.
  const raw = decodeURIComponent(run || '').replace(/^(?:run_id|runId|run)[=:]/i, '').trim()
  const id = /^[A-Za-z0-9_-]{1,120}$/.test(raw) ? raw : ''
  redirect(id ? `/chat/simulator?run=${encodeURIComponent(id)}` : '/chat/simulator')
}
