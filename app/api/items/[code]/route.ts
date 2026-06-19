import { NextResponse } from 'next/server'
import { client } from '@/lib/finansit-client'
import { initializeSecrets } from '@/lib/aws-secrets'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })

  try {
    await initializeSecrets()
    const upper = code.toUpperCase()

    // Try direct fetch and history in parallel; if the direct fetch fails (e.g.
    // the code is a historical/superseded alias), fall back to the canonical code.
    const [itemOrNull, history] = await Promise.all([
      client.items.get(upper).catch(() => null),
      client.items.getHistory(upper).catch(() => null),
    ])

    let item = itemOrNull
    if (!item) {
      const canonical = history?.canonical_code
      if (!canonical || canonical === upper) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      }
      item = await client.items.get(canonical)
    }

    return NextResponse.json({
      ...item,
      canonical_code: history?.canonical_code || item.code,
      canonical_name: history?.canonical_name || item.name,
      item_id_history: history?.item_id_history || item.item_id_history,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch item' },
      { status: 500 }
    )
  }
}
