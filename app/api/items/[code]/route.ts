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
    // Fetch full item data (stock, price, sales) and history chain in parallel
    const [item, history] = await Promise.all([
      client.items.get(code.toUpperCase()),
      client.items.getHistory(code.toUpperCase()).catch(() => null),
    ])
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
