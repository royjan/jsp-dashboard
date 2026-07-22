/**
 * Daily morning brief → the staff Telegram group, without any external cron.
 * Same in-app self-scheduling pattern as ebay-warm-loop: started once from
 * instrumentation.ts, ticks every ~10 min, and fires exactly once per day when
 * Israel local time enters the [07:00, 07:30) window — a Redis NX key
 * (morning-brief:posted:<date>) dedupes across ticks AND instances.
 *
 * Content = the existing /api/ai/morning-brief route (own 4h cache + deterministic
 * fallback), self-fetched like warm-cache does. Delivery = plain Telegram Bot API
 * sendMessage with the Diego bot token — the bot already sits in the staff group.
 *
 * Secrets: TELEGRAM_BOT_TOKEN (+ optional TELEGRAM_STAFF_CHAT_ID, default the
 * existing bot delivery group). Absent token → loop idles with one log line.
 * Kill switch: MORNING_BRIEF_DISABLED=true.
 */
import { initializeSecrets, getSecret } from './aws-secrets'
import { tryAcquireLock, setCache } from './redis-client'

// No hardcoded default — the v2-era group id turned out not to contain this bot at all.
// Set TELEGRAM_STAFF_CHAT_ID (group id once the bot is added to the staff group, or a DM id).
const DEFAULT_STAFF_CHAT = ''
const TICK_MIN = 10
const WINDOW_START_H = 7 // 07:00 Israel
const WINDOW_MIN = 30 // fire window [07:00, 07:30)
const FIRST_DELAY_MS = 120_000
const STATUS_KEY = 'morning-brief:status'

const heartbeat = (s: Record<string, unknown>) =>
  setCache(STATUS_KEY, { ...s, at: new Date().toISOString() }, 30 * 24 * 3600).catch(() => {})

let started = false
let warnedNoToken = false

export function startMorningBriefLoop(): void {
  if (started) return
  if (process.env.MORNING_BRIEF_DISABLED === 'true') {
    console.log('[morning-brief] disabled via MORNING_BRIEF_DISABLED')
    return
  }
  started = true
  const tick = () => {
    runOnce().catch((e) => {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[morning-brief] tick error:', msg)
      heartbeat({ phase: 'error', error: msg })
    })
  }
  setTimeout(tick, FIRST_DELAY_MS)
  setInterval(tick, TICK_MIN * 60_000)
  console.log(`[morning-brief] scheduled — checks every ${TICK_MIN} min for the 07:00 window`)
}

/** {hour, minute, dateKey} in Israel local time, DST-correct. */
function israelNow(): { hour: number; minute: number; dateKey: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return {
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    dateKey: `${get('year')}-${get('month')}-${get('day')}`,
  }
}

async function runOnce(force = false): Promise<void> {
  const now = israelNow()
  const inWindow = now.hour === WINDOW_START_H && now.minute < WINDOW_MIN
  if (!force && !inWindow) return

  await initializeSecrets()
  const token = getSecret('TELEGRAM_BOT_TOKEN', '')
  if (!token) {
    if (!warnedNoToken) {
      warnedNoToken = true
      console.log('[morning-brief] TELEGRAM_BOT_TOKEN not configured — loop idle')
    }
    return
  }

  // once per day, across ticks and instances (skipped when forced for testing)
  if (!force && !(await tryAcquireLock(`morning-brief:posted:${now.dateKey}`, 20 * 3600))) return

  // Self-fetch the existing route — it aggregates KPIs + AI summary with its own
  // cache and a deterministic Hebrew fallback, so this never needs its own logic.
  const port = process.env.PORT || 3000
  const r = await fetch(`http://127.0.0.1:${port}/api/ai/morning-brief`, {
    signal: AbortSignal.timeout(90_000),
  })
  const brief = (await r.json()) as { summary?: string; bullets?: string[]; error?: string }
  if (!r.ok || !brief.summary) throw new Error(`brief fetch failed: ${brief.error || r.status}`)

  const chatId = getSecret('TELEGRAM_STAFF_CHAT_ID', '') || DEFAULT_STAFF_CHAT
  if (!chatId) {
    console.log('[morning-brief] TELEGRAM_STAFF_CHAT_ID not configured — loop idle')
    return
  }
  const text = [
    `☀️ בוקר טוב! תקציר ${now.dateKey.split('-').reverse().join('.')}`,
    '',
    brief.summary,
    ...(brief.bullets?.length ? ['', ...brief.bullets.map((b) => `• ${b}`)] : []),
  ].join('\n')

  const tg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
    signal: AbortSignal.timeout(30_000),
  })
  const tgBody = (await tg.json().catch(() => ({}))) as { ok?: boolean; description?: string }
  if (!tgBody.ok) throw new Error(`telegram send failed: ${tgBody.description || tg.status}`)
  heartbeat({ phase: 'posted', chatId, chars: text.length })
  console.log(`[morning-brief] posted to ${chatId} (${text.length} chars)`)
}

/** Test hook: post NOW regardless of window/dedupe (used once at rollout). */
export function forceMorningBriefPost(): Promise<void> {
  return runOnce(true)
}
