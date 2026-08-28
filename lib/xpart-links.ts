/**
 * Deep links into the Xpart app.
 *
 * Everything the dashboard shows from Xpart is read-only, so every screen needs
 * an exit: the place where you can actually act on what you just read. These
 * build that link.
 *
 * The base is configurable because Xpart moves between the LAN box and whatever
 * it is deployed on next, and a hardcoded IP in a dozen components is how you
 * end up with half of them pointing at a dead host.
 */

const DEFAULT_BASE = 'http://192.168.0.110:3000'

export function xpartBaseUrl(): string {
  // NEXT_PUBLIC_ so the client components rendering these links can read it.
  return (process.env.NEXT_PUBLIC_XPART_APP_URL || DEFAULT_BASE).replace(/\/+$/, '')
}

export const xpartUrl = {
  priceList: (id: string) => `${xpartBaseUrl()}/price-lists/${encodeURIComponent(id)}`,
  inquiry: (id: string) => `${xpartBaseUrl()}/inquiries/${encodeURIComponent(id)}`,
  comparison: (id: string) => `${xpartBaseUrl()}/inquiries/${encodeURIComponent(id)}/comparison`,
  order: (id: string) => `${xpartBaseUrl()}/orders/${encodeURIComponent(id)}`,
  supplier: (id: string) => `${xpartBaseUrl()}/suppliers/${encodeURIComponent(id)}`,
  shipment: (id: string) => `${xpartBaseUrl()}/shipments/${encodeURIComponent(id)}`,
}
