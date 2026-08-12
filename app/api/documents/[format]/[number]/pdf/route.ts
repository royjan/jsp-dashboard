export const maxDuration = 60

import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { fetchDocumentPdf } from '@/lib/finansit-client'

/**
 * Streams a document PDF (תעודת משלוח, חשבונית, הזמנה) straight from FINAPI.
 *
 * The synced `dashboard.document_lines` cannot stand in for this: only 167 of
 * 1133 delivery notes for a sampled supplier have any lines at all, and those
 * carry quantity 0 / line_total 0 against a non-zero header. The ERP's own
 * rendering is the only complete representation of the document.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ format: string; number: string }> },
) {
  try {
    await initializeSecrets()
    const { format, number } = await params
    const year = new URL(request.url).searchParams.get('year') || undefined

    const upstream = await fetchDocumentPdf(format, number, year)
    const body = await upstream.arrayBuffer()

    // `inline` so a click opens the viewer; the UI adds ?download=1 when the
    // user explicitly asks to save it.
    const disposition = new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline'
    const filename = `${format}-${number}${year ? `-${year}` : ''}.pdf`

    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${filename}"`,
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch document PDF' },
      { status: 502 },
    )
  }
}
