/**
 * Redis-cached single-document detail (header + line items).
 *
 * Shared by the document-detail API route and the customer purchase drill-down,
 * so a document's lines are fetched from FINAPI once regardless of which view
 * asked first. Posted documents are immutable; 7 days bounds staleness if one
 * is ever voided/reissued.
 */
import { fetchDocumentDetail } from '../finansit-client'
import { getCached, setCache } from '../redis-client'

const CACHE_TTL = 7 * 86400

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getDocumentDetailCached(format: string, number: string, year?: string): Promise<any> {
  const key = `doc-detail:v1:${format}:${year || 'active'}:${number}`
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cached = await getCached<any>(key)
  if (cached) return cached

  const doc = await fetchDocumentDetail(format, number, year)
  // Never cache errors or line-less payloads.
  if (doc && !doc.error && Array.isArray(doc.lines) && doc.lines.length > 0) {
    await setCache(key, doc, CACHE_TTL)
  }
  return doc
}
