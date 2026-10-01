// SERVER ONLY — the shared body of the /api/vehicle-twins/* proxy routes.
import { NextResponse } from 'next/server'
import { currentViewer, partlyFetch, type Viewer } from '@/lib/partly-internal'

/** Reads need a signed-in session (API routes sit outside the page middleware). */
export async function requireReader(): Promise<{ viewer: Viewer } | { res: NextResponse }> {
  const viewer = await currentViewer()
  if (viewer.authOn && !viewer.email) {
    return { res: NextResponse.json({ error: 'יש להתחבר לדשבורד' }, { status: 401 }) }
  }
  return { viewer }
}

/** Writes need a signed-in dashboard ADMIN — Partly then checks the same email again. */
export async function requireAdmin(): Promise<{ viewer: Viewer & { email: string } } | { res: NextResponse }> {
  const viewer = await currentViewer()
  if (!viewer.email) {
    return { res: NextResponse.json({ error: 'יש להתחבר לדשבורד כדי לערוך' }, { status: 401 }) }
  }
  if (!viewer.canEdit) {
    return { res: NextResponse.json({ error: `למשתמש ${viewer.email} אין הרשאת עריכה` }, { status: 403 }) }
  }
  return { viewer: viewer as Viewer & { email: string } }
}

export async function readBody(req: Request): Promise<{ body: unknown } | { res: NextResponse }> {
  const text = await req.text()
  if (!text) return { body: undefined }
  try { return { body: JSON.parse(text) } } catch {
    return { res: NextResponse.json({ error: 'גוף בקשה לא תקין (JSON)' }, { status: 400 }) }
  }
}

export async function forward(
  path: string,
  init: { method?: string; body?: unknown; actingUser?: string | null; timeoutMs?: number } = {},
): Promise<NextResponse> {
  const { status, body } = await partlyFetch(path, init)
  return NextResponse.json(body ?? {}, { status, headers: { 'Cache-Control': 'no-store' } })
}

export const idPath = (id: string) => `/api/vehicle-twins/${encodeURIComponent(id)}`
