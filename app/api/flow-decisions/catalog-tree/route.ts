import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getCatalogTree } from '@/lib/chat-admin/flow-decisions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/flow-decisions/catalog-tree?lambda= — nested category→subcategory→schema with counts. */
export async function GET(request: NextRequest) {
  try {
    await initializeSecrets()
    const lambda = request.nextUrl.searchParams.get('lambda') || undefined
    const tree = await getCatalogTree(lambda)
    return NextResponse.json({ tree })
  } catch (error) {
    console.error('[flow-decisions/catalog-tree] failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'failed' }, { status: 500 })
  }
}
