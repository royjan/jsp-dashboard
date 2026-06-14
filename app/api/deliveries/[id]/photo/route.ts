import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getDb } from '@/lib/db'
import { deliveryPhotos } from '@/lib/db/schema'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await initializeSecrets()
    const db = await getDb()
    const { id } = await params
    const body = await request.json()
    const { photo, photo_type, notes } = body

    if (!photo) {
      return NextResponse.json({ error: 'photo (base64) is required' }, { status: 400 })
    }

    const [newPhoto] = await db
      .insert(deliveryPhotos)
      .values({
        deliveryId: id,
        photoUrl: photo,
        photoType: photo_type || 'delivery',
        notes: notes || null,
      })
      .returning()

    return NextResponse.json(newPhoto, { status: 201 })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload photo' },
      { status: 500 }
    )
  }
}
