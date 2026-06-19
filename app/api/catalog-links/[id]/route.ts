import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initializeSecrets()
    const { id } = await params
    await query(`DELETE FROM partly.finansit_links WHERE id = $1`, [id])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'error' }, { status: 500 })
  }
}
