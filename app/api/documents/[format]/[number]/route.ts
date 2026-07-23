import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { getDocumentDetailCached } from '@/lib/services/doc-detail'

export const runtime = 'nodejs'
export const maxDuration = 30

// Document detail (header + line items) as JSON. Hebrew comes back in correct
// logical order here (unlike the FINAPI-generated PDF, which renders it reversed),
// so the dashboard renders its own readable HTML document view from this.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ format: string; number: string }> }
) {
  try {
    await initializeSecrets()
    const { format, number } = await params
    const year = new URL(req.url).searchParams.get('year') || undefined
    const doc = await getDocumentDetailCached(format, number, year)
    return NextResponse.json(doc)
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
