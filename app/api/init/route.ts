import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'

let initialized = false

export async function GET() {
  if (initialized) {
    return NextResponse.json({ status: 'already_initialized' })
  }

  try {
    await initializeSecrets()
    initialized = true
    return NextResponse.json({ status: 'initialized' })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to initialize' },
      { status: 500 }
    )
  }
}
