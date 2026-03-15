import { getSecret, initializeSecrets } from './aws-secrets'

const BASE_URL = 'https://finansit.jan.parts'

let authHeader: string | null = null

async function getAuthHeader(): Promise<string> {
  if (authHeader) return authHeader
  await initializeSecrets()
  const credentials = getSecret('FINANSIT_API_CREDENTIALS', '')
  if (!credentials) throw new Error('FINANSIT_API_CREDENTIALS not configured')
  authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`
  return authHeader
}

export async function callEndpoint(path: string, params?: Record<string, string>): Promise<any> {
  let url = `${BASE_URL}${path}`

  if (params && Object.keys(params).length > 0) {
    const queryParams: Record<string, string> = {}
    for (const [key, value] of Object.entries(params)) {
      const placeholder = `{${key}}`
      if (url.includes(placeholder)) {
        url = url.replace(placeholder, encodeURIComponent(value))
      } else {
        queryParams[key] = value
      }
    }
    if (Object.keys(queryParams).length > 0) {
      url += '?' + new URLSearchParams(queryParams).toString()
    }
  }

  const auth = await getAuthHeader()
  const response = await fetch(url, {
    method: 'GET',
    headers: { Authorization: auth },
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Finansit API error ${response.status}: ${errorText}`)
  }

  return response.json()
}

// ── Items ──

/** Fetch all items (paginated with start param). Returns basic fields only. */
export async function fetchItems(): Promise<any[]> {
  // The API returns items sorted by code, paginated via ?start=CODE&limit=N
  // Default limit is 500. We fetch all by paginating.
  let allItems: any[] = []
  let start = ''
  const limit = 500

  while (true) {
    const params: Record<string, string> = { limit: String(limit) }
    if (start) params.start = start
    const data = await callEndpoint('/api/items', params)
    const items = data.items || []
    if (items.length === 0) break

    allItems = allItems.concat(items)

    // If we got less than limit, we're done
    if (items.length < limit) break

    // Next page starts after the last item's code
    const lastCode = items[items.length - 1].code
    if (lastCode === start) break // safety
    start = lastCode
  }

  return allItems
}

/** Fetch single item with enriched data (stock, sold history) */
export async function fetchItemDetail(code: string): Promise<any> {
  return callEndpoint(`/api/items/${encodeURIComponent(code.toUpperCase())}`)
}

/** Search items by name */
export async function searchItems(query: string): Promise<any[]> {
  const data = await callEndpoint('/api/items/search', { q: query })
  return data.items || []
}

// ── Stock ──

export async function fetchStock(code: string): Promise<any> {
  return callEndpoint(`/api/stock/${encodeURIComponent(code.toUpperCase())}`)
}

export async function fetchBatchStock(codes: string[]): Promise<any[]> {
  if (!codes.length) return []
  // Use POST which returns richer data (total_qty, total_ordered, total_incoming, total_sold_this_year)
  const auth = await getAuthHeader()
  const response = await fetch(`${BASE_URL}/api/stock/batch`, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_codes: codes.map(c => c.toUpperCase()) }),
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`Finansit API error ${response.status}: ${errorText}`)
  }
  const data = await response.json()
  return data.items || data || []
}

// ── Documents ──

export async function fetchDocuments(format: number, limit?: number): Promise<any[]> {
  const params: Record<string, string> = { direction: 'desc' }
  if (limit) params.limit = String(limit)
  const data = await callEndpoint(`/api/documents/list/${format}`, params)
  return data.documents || data || []
}

export async function fetchDocumentDetail(format: number | string, number: number | string): Promise<any> {
  return callEndpoint(`/api/documents/${format}/${number}`)
}

/** Search documents. Uses doc_format (not format) for the format filter. */
export async function searchDocuments(params: Record<string, string>): Promise<any[]> {
  // Map our internal keys to what the API expects
  const apiParams: Record<string, string> = {}
  for (const [key, value] of Object.entries(params)) {
    if (key === 'format') {
      apiParams.doc_format = value
    } else {
      apiParams[key] = value
    }
  }
  const data = await callEndpoint('/api/documents/search', apiParams)
  return data.documents || data || []
}

// ── Dashboard ──

export async function fetchDashboard(): Promise<any> {
  return callEndpoint('/api/dashboard')
}

// ── SQL ──

export async function fetchSqlQuery(query: string): Promise<any> {
  return callEndpoint('/api/sql/query', { q: query })
}

export async function fetchSqlTables(): Promise<any> {
  return callEndpoint('/api/sql/tables')
}

export async function fetchSqlColumns(table: string): Promise<any> {
  return callEndpoint(`/api/sql/columns/${table}`)
}
