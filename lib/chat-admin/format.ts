/**
 * Shared micro-formatters for chat-admin views (session lists, traces, rule tables).
 * All date output uses he-IL; timestamps from ADK arrive UTC without a trailing Z.
 */

/** ADK timestamps come without a timezone marker but are UTC. */
export function parseAdkTs(ts: string): Date | null {
  const d = new Date(ts + (/Z|[+-]\d\d:?\d\d$/.test(ts) ? '' : 'Z'))
  return isNaN(d.getTime()) ? null : d
}

/** "14:32" — time only; the day context comes from day separators / tooltips. */
export function fmtTimeShort(ts: string): string {
  const d = parseAdkTs(ts)
  return d ? d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : ts
}

/** Full date+time, for tooltips. */
export function fmtDateTime(ts: string): string {
  const d = parseAdkTs(ts)
  return d ? d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'medium' }) : ts
}

/** "יום שלישי 14.7" / "היום" / "אתמול" — day-separator label. */
export function fmtDayLabel(ts: string): string {
  const d = parseAdkTs(ts)
  if (!d) return ts
  const today = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(today) - startOf(d)) / 86400000)
  if (days === 0) return 'היום'
  if (days === 1) return 'אתמול'
  return d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'numeric' })
}

/** Calendar-day key ("2026-07-21") for grouping/day-separator changes. */
export function dayKey(ts: string): string {
  const d = parseAdkTs(ts)
  return d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : ts
}

/** "just now" / "12m ago" / "3h ago" / "5d ago" / ISO date beyond a week. */
export function relTime(ts: string | Date): string {
  const d = typeof ts === 'string' ? parseAdkTs(ts) ?? new Date(ts) : ts
  if (isNaN(d.getTime())) return String(ts)
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d ago`
  return d.toISOString().slice(0, 10)
}

/** 1234 -> "1.2k" */
export function compactCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}
