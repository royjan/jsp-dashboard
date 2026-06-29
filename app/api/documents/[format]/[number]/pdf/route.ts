import { NextRequest, NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { fetchDocumentPdf } from '@/lib/finansit-client'

export const runtime = 'nodejs'
export const maxDuration = 30

// Stream a document's PDF (invoice/quote/delivery note/credit note) from FINAPI.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ format: string; number: string }> }
) {
  try {
    await initializeSecrets()
    const { format, number } = await params
    const year = new URL(req.url).searchParams.get('year') || undefined

    const res = await fetchDocumentPdf(format, number, year)
    if (!res.ok) {
      return NextResponse.json(
        { error: `Document PDF unavailable (${res.status})` },
        { status: res.status }
      )
    }
    const buf = await res.arrayBuffer()
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="doc-${format}-${number}.pdf"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
