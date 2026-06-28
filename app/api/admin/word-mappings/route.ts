import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getAllMappings, createMapping, type MappingType } from '@/lib/chat-admin/word-mappings'

export const dynamic = 'force-dynamic'

/** GET /api/admin/word-mappings — list with filtering + pagination */
export async function GET(request: NextRequest) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(request.url)
    const isActiveParam = searchParams.get('isActive')

    const result = await getAllMappings({
      page: parseInt(searchParams.get('page') || '1'),
      pageSize: parseInt(searchParams.get('pageSize') || '50'),
      search: searchParams.get('search') || undefined,
      searchSource: searchParams.get('searchSource') || undefined,
      searchTarget: searchParams.get('searchTarget') || undefined,
      language: searchParams.get('language') || undefined,
      mappingType: (searchParams.get('mappingType') as MappingType) || undefined,
      isActive: isActiveParam === 'true' ? true : isActiveParam === 'false' ? false : undefined,
      firstLetter: searchParams.get('firstLetter') || undefined,
      sortBy: (searchParams.get('sortBy') as 'sourceWord' | 'targetWord' | 'usageCount' | 'createdAt') || undefined,
      sortOrder: (searchParams.get('sortOrder') as 'asc' | 'desc') || undefined,
    })

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error fetching word mappings:', error)
    return NextResponse.json({ error: 'Failed to fetch word mappings' }, { status: 500 })
  }
}

/** POST /api/admin/word-mappings — create */
export async function POST(request: NextRequest) {
  try {
    await initializeSecrets()
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { sourceWord, sourceLanguage, targetWord, targetLanguage, mappingType } = body
    if (!sourceWord || !sourceLanguage || !targetWord || !targetLanguage || !mappingType) {
      return NextResponse.json(
        { error: 'Missing required fields: sourceWord, sourceLanguage, targetWord, targetLanguage, mappingType' },
        { status: 400 },
      )
    }
    if (!['en', 'he', 'zh'].includes(sourceLanguage) || !['en', 'he', 'zh'].includes(targetLanguage)) {
      return NextResponse.json({ error: 'Invalid language. Must be "en", "he", or "zh"' }, { status: 400 })
    }
    if (!['translation', 'synonym'].includes(mappingType)) {
      return NextResponse.json({ error: 'Invalid mapping type. Must be "translation" or "synonym"' }, { status: 400 })
    }
    if (mappingType === 'translation' && sourceLanguage === targetLanguage) {
      return NextResponse.json({ error: 'Translation mappings must be between different languages' }, { status: 400 })
    }
    if (mappingType === 'synonym' && sourceLanguage !== targetLanguage) {
      return NextResponse.json({ error: 'Synonym mappings must be in the same language' }, { status: 400 })
    }

    const mapping = await createMapping({
      sourceWord,
      sourceLanguage,
      targetWord,
      targetLanguage,
      mappingType,
      category: body.category,
      metadata: body.metadata,
      createdBy: body.createdBy || 'admin',
    })

    return NextResponse.json(mapping, { status: 201 })
  } catch (error) {
    console.error('Error creating word mapping:', error)
    if (error instanceof Error && error.message.includes('already exists')) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create word mapping' }, { status: 500 })
  }
}
