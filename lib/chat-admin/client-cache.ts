/**
 * Client-side flow-decisions cache key helpers (ported from jsp-chat-js).
 * The dashboard does not use the chat in-memory conversation cache, so the
 * clear function is a no-op kept for API compatibility with the ported hook.
 */

export function clearFlowDecisionsCache(): void {
  // no-op in the dashboard (no client-side conversation cache)
}

export function generateFlowDecisionsCacheKey(
  status: string | undefined,
  page: number,
  pageSize: number,
  search: string | undefined,
  orderBy: string,
  orderDirection: string,
): string {
  return `flow-decisions:${status || 'all'}:${page}:${pageSize}:${search || ''}:${orderBy}:${orderDirection}`
}
