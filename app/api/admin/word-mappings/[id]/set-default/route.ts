import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { setDefaultMapping } from '@/lib/chat-admin/word-mappings'

export const dynamic = 'force-dynamic'

/** POST /api/admin/word-mappings/[id]/set-default */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initializeSecrets()
    const { id } = await params
    const mapping = await setDefaultMapping(id)
    return NextResponse.json(mapping)
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json({ error: 'Word mapping not found' }, { status: 404 })
    }
    console.error('Error setting default mapping:', error)
    return NextResponse.json({ error: 'Failed to set default mapping' }, { status: 500 })
  }
}
