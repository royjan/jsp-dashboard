import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getMapping, updateMapping, deleteMapping } from '@/lib/chat-admin/word-mappings'

export const dynamic = 'force-dynamic'

/** GET /api/admin/word-mappings/[id] */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initializeSecrets()
    const { id } = await params
    const mapping = await getMapping(id)
    if (!mapping) return NextResponse.json({ error: 'Word mapping not found' }, { status: 404 })
    return NextResponse.json(mapping)
  } catch (error) {
    console.error('Error fetching word mapping:', error)
    return NextResponse.json({ error: 'Failed to fetch word mapping' }, { status: 500 })
  }
}

/** PUT /api/admin/word-mappings/[id] */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initializeSecrets()
    const { id } = await params
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (body.sourceLanguage && !['en', 'he', 'zh'].includes(body.sourceLanguage)) {
      return NextResponse.json({ error: 'Invalid source language' }, { status: 400 })
    }
    if (body.targetLanguage && !['en', 'he', 'zh'].includes(body.targetLanguage)) {
      return NextResponse.json({ error: 'Invalid target language' }, { status: 400 })
    }
    if (body.mappingType && !['translation', 'synonym'].includes(body.mappingType)) {
      return NextResponse.json({ error: 'Invalid mapping type' }, { status: 400 })
    }

    const mapping = await updateMapping(id, body)
    return NextResponse.json(mapping)
  } catch (error) {
    if ((error as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: 'Word mapping not found' }, { status: 404 })
    }
    console.error('Error updating word mapping:', error)
    return NextResponse.json({ error: 'Failed to update word mapping' }, { status: 500 })
  }
}

/** DELETE /api/admin/word-mappings/[id] */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await initializeSecrets()
    const { id } = await params
    await deleteMapping(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    if ((error as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: 'Word mapping not found' }, { status: 404 })
    }
    console.error('Error deleting word mapping:', error)
    return NextResponse.json({ error: 'Failed to delete word mapping' }, { status: 500 })
  }
}
