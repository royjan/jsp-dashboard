'use client'

/**
 * Diego v3 (ADK) sessions browser — session list (one per car/VIN) + full turn-by-turn
 * trace: customer messages, per-node outputs (state deltas), schema diagrams, final answers.
 * Read-only over the diego_v3 schema via /api/diego/sessions.
 *
 * The trace doubles as the debugging workbench: per-turn permalinks, latency bar,
 * observatory deep links ("why this rule?"), re-check-vs-current-rules, and a raw-JSON
 * escape hatch — adk web is only the fallback.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  Bot, Car, CheckCheck, ChevronLeft, ChevronRight, ExternalLink, Link2, ListFilter,
  Plus, Radar, RefreshCw, Radio, Search, Trash2, User, X,
} from 'lucide-react'
import { Panel } from '@/components/chat-admin/Panel'
import { CustomerLink } from '@/components/shared/CustomerLink'
import { ItemLink } from '@/components/shared/ItemLink'
import { NODE_COLORS, TURN_STATUS_BAR, TURN_STATUS_DOT, type TurnStatus } from '@/components/chat-admin/shared/colors'
import { dayKey, fmtDateTime, fmtDayLabel, fmtTimeShort, relTime } from '@/lib/chat-admin/format'
import { copyText } from '@/lib/chat-admin/clipboard'
import { toast } from '@/lib/toast'

const ADK_WEB = process.env.NEXT_PUBLIC_ADK_WEB_BASE ?? 'http://192.168.0.230:8000'

interface SessionSummary {
  userId: string
  sessionId: string
  updateTime: string
  events: number
  turns: number
  vehicle: string | null
  lastUserText: string | null
  customerName: string | null
  doraEvents: number
  stockEvents: number
  errEvents: number
  unanswered: boolean
}

interface DiegoEvent {
  id: string
  author: string
  timestamp: string
  text: string
  toolEvents: string[]
  stateDelta: Record<string, unknown> | null
  nodePath: string | null
  outputFor: string[] | null
  images: string[]
  raw?: unknown
}

const URL_SPLIT = /(https?:\/\/\S+)/g
const IMG_LINE = /^https?:\/\/\S+\.(?:png|jpe?g|webp)\s*$/i
const ITEM_URL = /\/items\/([\w.%-]+)/

/** ADK user ids are zero-padded Finansit customer codes ("0000032722") — link them. */
function customerCode(uid: string): string | null {
  return /^\d+$/.test(uid) ? String(Number(uid)) : null
}

/** "32722" and "0000032722" are the same ADK user; non-numeric ids match exactly. */
function sameUser(a: string, b: string): boolean {
  if (a === b) return true
  return /^\d+$/.test(a) && /^\d+$/.test(b) && Number(a) === Number(b)
}

/** URL user segment -> the id ADK stores (numeric codes are zero-padded to 10). */
function normalizeUser(u: string): string {
  return /^\d+$/.test(u) ? u.padStart(10, '0') : u
}

function tryPrettyJson(text: string): string | null {
  const t = text.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return null
  try {
    return JSON.stringify(JSON.parse(t), null, 2)
  } catch {
    return null
  }
}

/** Message-level base direction (first strong character) — the whole message aligns to one
 *  edge instead of per-line "ping-pong" when a Hebrew answer contains English/SKU lines. */
function baseDir(text: string): 'rtl' | 'ltr' {
  const m = text.match(/[֐-׿]|[A-Za-z]/)
  return m && /[֐-׿]/.test(m[0]) ? 'rtl' : 'ltr'
}

// Bare part-number/VIN-ish tokens inside Hebrew text (must contain a digit, ≥5 chars) get
// BiDi-isolated so "מק״ט 9812345680-A" never reorders around the punctuation.
const CODE_TOKEN = /((?=[A-Z0-9./-]*\d)[A-Z0-9][A-Z0-9./-]{4,})/g

function PlainWithCodes({ text }: { text: string }) {
  const segs = text.split(CODE_TOKEN)
  if (segs.length === 1) return <>{text}</>
  return (
    <>
      {segs.map((s, i) =>
        /^(?=[A-Z0-9./-]*\d)[A-Z0-9][A-Z0-9./-]{4,}$/.test(s) ? (
          <bdi key={i} dir="ltr" className="font-mono">{s}</bdi>
        ) : (
          <span key={i}>{s}</span>
        )
      )}
    </>
  )
}

const FLOW_ID = /(#[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g

/** One line of bot/customer text: BiDi-ordered per line (dir=auto on an inline span) while
 *  the alignment edge comes from the message container's base direction. URLs become real
 *  links — item codes get the customers-page hover card (ItemLink), the 🧭 flow line's
 *  #<uuid> links the exact flow_decisions_v2 row, other URLs get a shortened label. */
function LinkifiedLine({ line }: { line: string }) {
  const parts = line.split(URL_SPLIT)
  return (
    <div className="whitespace-pre-wrap break-words">
      <span dir="auto">
        {parts.map((p, i) => {
          if (/^https?:\/\//i.test(p)) {
            const item = p.match(ITEM_URL)
            if (item) {
              // part code with the live stock/price hover card (same as /customers/<code>)
              return <ItemLink key={i} code={decodeURIComponent(item[1])} showCode copyable={false} />
            }
            // flow-decision URL (diego-adk emits these since 97d843a) -> short "#4d5acaa1" link
            const flow = p.match(/\/chat\/flow-decisions\?q=([0-9a-f]{8})[0-9a-f-]{28}/i)
            if (flow) {
              return (
                <a
                  key={i}
                  href={p.slice(p.indexOf('/chat/'))}
                  target="_blank"
                  rel="noreferrer"
                  dir="ltr"
                  title={p}
                  className="inline-flex items-baseline gap-0.5 font-mono text-emerald-400 hover:underline"
                >
                  #{flow[1]}
                  <ExternalLink className="inline h-3 w-3 opacity-60" />
                </a>
              )
            }
            const label = p.replace(/^https?:\/\//i, '').slice(0, 44) + (p.length > 52 ? '…' : '')
            return (
              <a
                key={i}
                href={p}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
                className="inline-flex items-baseline gap-0.5 font-mono text-blue-400 hover:underline"
              >
                {label}
                <ExternalLink className="inline h-3 w-3 opacity-60" />
              </a>
            )
          }
          if (!line.includes('החלטת זרימה')) return <PlainWithCodes key={i} text={p} />
          // flow line: "#<uuid>" -> short link to the flow-decision editor
          return (
            <span key={i}>
              {p.split(FLOW_ID).map((s, j) =>
                /^#[0-9a-f-]{36}$/.test(s) ? (
                  <a
                    key={j}
                    href={`/chat/flow-decisions/edit/${s.slice(1)}`}
                    target="_blank"
                    rel="noreferrer"
                    dir="ltr"
                    title={s}
                    className="inline-flex items-baseline gap-0.5 font-mono text-emerald-400 hover:underline"
                  >
                    #{s.slice(1, 9)}
                    <ExternalLink className="inline h-3 w-3 opacity-60" />
                  </a>
                ) : (
                  <span key={j}>{s}</span>
                )
              )}
            </span>
          )
        })}
      </span>
    </div>
  )
}

const FLOW_PREFIX = '🧭 החלטת זרימה:'

/** One breadcrumb chip: "HEADLIGHT - GLASS - LAMP [100]" -> label + score badge. */
function FlowSegment({ seg }: { seg: string }) {
  const m = seg.match(/^(.*?)\s*\[(\d+)\]$/)
  const label = m ? m[1] : seg
  const score = m ? m[2] : null
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-xs text-indigo-200">
      {label}
      {score && (
        <span className="rounded bg-indigo-500/20 px-1 font-mono text-[10px] leading-4 text-indigo-300/80">{score}</span>
      )}
    </span>
  )
}

/** The 🧭 flow-decision line as a breadcrumb: chips joined by arrows, the rule id as a short
 *  link (new full-URL format and the older bare "#<uuid>" both), source tag ("PSA"/"מוצמד") at the end. */
function FlowDecisionLine({ line }: { line: string }) {
  let rest = line.trim().slice(FLOW_PREFIX.length).trim()
  let tag: string | null = null
  const tagM = rest.match(/\(([^()]+)\)\s*$/)
  if (tagM) {
    tag = tagM[1]
    rest = rest.slice(0, tagM.index).trim()
  }
  return (
    <div dir="ltr" className="flex flex-wrap items-center gap-1.5 py-0.5">
      <span title="החלטת זרימה">🧭</span>
      {rest.split(' | ').map((item, i) => {
        let path = item.trim()
        let ruleId: string | null = null
        const urlM = path.match(/https?:\/\/\S+\/chat\/flow-decisions\?q=([0-9a-f-]{36})/i)
        const idM = urlM ? null : path.match(/#([0-9a-f-]{36})/i)
        if (urlM) {
          ruleId = urlM[1]
          path = path.replace(urlM[0], '').trim()
        } else if (idM) {
          ruleId = idM[1]
          path = path.replace(idM[0], '').trim()
        }
        const segs = path.split('→').map((s) => s.trim()).filter(Boolean)
        return (
          <span key={i} className="inline-flex flex-wrap items-center gap-1.5">
            {i > 0 && <span className="text-gray-600">|</span>}
            {segs.map((s, j) => (
              <span key={j} className="inline-flex items-center gap-1.5">
                {j > 0 && <ChevronRight className="h-3.5 w-3.5 text-gray-500" />}
                <FlowSegment seg={s} />
              </span>
            ))}
            {ruleId && (
              <a
                href={`/chat/flow-decisions?q=${ruleId}`}
                target="_blank"
                rel="noreferrer"
                title={ruleId}
                className="inline-flex items-baseline gap-0.5 font-mono text-xs text-emerald-400 hover:underline"
              >
                #{ruleId.slice(0, 8)}
                <ExternalLink className="inline h-3 w-3 opacity-60" />
              </a>
            )}
          </span>
        )
      })}
      {tag && (
        <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[10px] text-purple-300">
          {tag}
        </span>
      )}
    </div>
  )
}

// '#1) התאמה=87, תיאור=..., מק"ט: X, מספר בשרטוט=5, במלאי=..., מחיר=..., קישור=...'
// Anchored on the field names because במלאי can itself contain commas (the Lubinski phrase).
const PART_LINE_RE =
  /^#(\d+)\)\s*(?:התאמה=(\d+),\s*)?תיאור=(.*?),\s*מק"ט:\s*(\S+),\s*מספר בשרטוט=(.*?),\s*במלאי=(.*?),\s*מחיר=(.*?),\s*קישור=(\S+)$/

/** One answer part-line as a compact card with bullets (name header, then SKU / diagram
 *  number / stock / price). The קישור field is dropped — the SKU itself is the ItemLink. */
function PartLine({ line }: { line: string }) {
  const m = line.trim().match(PART_LINE_RE)
  if (!m) return <LinkifiedLine line={line} />
  const [, idx, conf, name, pn, num, stock, price] = m
  const fromSupplier = stock.includes('לובינסקי')
  return (
    <div dir="rtl" className="my-1 rounded-lg border border-[var(--color-border-default)] bg-black/20 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-gray-500">#{idx}</span>
        <span dir="auto" className="text-sm font-medium text-gray-100">{name}</span>
        {conf && <span className="text-[10px] text-gray-500">התאמה {conf}%</span>}
      </div>
      <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-gray-300 marker:text-gray-600">
        <li>מק״ט: <ItemLink code={pn} showCode /></li>
        <li>מספר בשרטוט: <span className="font-mono text-gray-200">{num}</span></li>
        <li className={fromSupplier ? 'text-sky-400' : undefined}>במלאי: {stock}</li>
        <li>מחיר: <span className="font-mono text-gray-200">{price}</span></li>
      </ul>
    </div>
  )
}

/** Event body: pretty-print pure-JSON content (extract_slots), otherwise line-by-line with
 *  links; bare image-URL lines are dropped (the diagram renders below anyway). The container
 *  carries the message's base direction so all lines share one alignment edge. */
function EventBody({ text }: { text: string }) {
  const pretty = tryPrettyJson(text)
  if (pretty) {
    return (
      <pre className="max-h-72 overflow-auto rounded bg-black/40 p-2 text-xs leading-5 text-amber-200/90">
        {pretty}
      </pre>
    )
  }
  const lines = text.split('\n').filter((l) => !IMG_LINE.test(l.trim()))
  return (
    <div dir={baseDir(text)} className="space-y-0.5 text-start text-sm text-gray-200">
      {lines.map((l, i) =>
        l.trim().startsWith(FLOW_PREFIX) ? (
          <FlowDecisionLine key={i} line={l} />
        ) : PART_LINE_RE.test(l.trim()) ? (
          <PartLine key={i} line={l} />
        ) : (
          <LinkifiedLine key={i} line={l} />
        )
      )}
    </div>
  )
}

// ── per-turn pipeline grouping ────────────────────────────────────────────────
// A turn = a user event plus everything until the next user event. The event
// stamped output_for (format_v2's final answer) renders as the answer bubble;
// the intermediate node events render as a clickable pipeline strip.

interface TurnNode {
  e: DiegoEvent
  /** seconds since the previous event — the node's wall time */
  dur: number | null
}
interface Turn {
  user: DiegoEvent | null
  nodes: TurnNode[]
  answer: DiegoEvent | null
}

function parseTs(ts: string): number | null {
  const t = Date.parse(ts + (ts.endsWith('Z') ? '' : 'Z'))
  return Number.isNaN(t) ? null : t
}

function groupTurns(events: DiegoEvent[]): Turn[] {
  const turns: Turn[] = []
  let cur: Turn | null = null
  let prev: DiegoEvent | null = null
  for (const e of events) {
    if (e.author === 'user') {
      cur = { user: e, nodes: [], answer: null }
      turns.push(cur)
      prev = e
      continue
    }
    if (!cur) {
      cur = { user: null, nodes: [], answer: null }
      turns.push(cur)
    }
    const a = parseTs(e.timestamp)
    const b = prev ? parseTs(prev.timestamp) : null
    cur.nodes.push({ e, dur: a != null && b != null ? Math.max(0, (a - b) / 1000) : null })
    prev = e
  }
  for (const t of turns) {
    // output_for marks the final answer; newer traces leave it null, so fall back to the
    // last format_v2/dora_flow node that actually said something (= the customer-facing reply)
    let idx = t.nodes.map((n) => !!n.e.outputFor).lastIndexOf(true)
    if (idx < 0)
      idx = t.nodes
        .map((n) => (n.e.author === 'format_v2' || n.e.author === 'dora_flow') && !!n.e.text.trim())
        .lastIndexOf(true)
    if (idx >= 0) t.answer = t.nodes.splice(idx, 1)[0].e
  }
  return turns
}

function fmtDur(d: number | null): string {
  if (d == null) return ''
  if (d >= 60) return `${Math.floor(d / 60)}m ${Math.round(d % 60)}s`
  if (d >= 10) return `${Math.round(d)}s`
  return `${d.toFixed(1)}s`
}

function nodeStatus(e: DiegoEvent, dur: number | null): TurnStatus {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sd: any = e.stateDelta || {}
  for (const [k, v] of Object.entries(sd)) {
    if (k.endsWith('error') && v) return 'err'
  }
  if (sd.search?.error) return 'err'
  if (dur != null && dur > 20) return 'slow'
  return 'ok'
}

/** "checked 2 zero-stock part(s) at Lubinski -> 0 available" → "2→0" */
function nodeBadge(e: DiegoEvent): string | null {
  const m = e.text.match(/checked (\d+) zero-stock part\(s\) at Lubinski -> (\d+)/)
  return m ? `${m[1]}→${m[2]}` : null
}

/** Header line for a collapsed turn: what was searched, how it went, how long it took. */
function turnSummary(turn: Turn) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slots: any = turn.nodes.find((n) => n.e.author === 'extract_slots')?.e.stateDelta
  const parts: string[] = Array.isArray(slots?.stock_query?.part_descriptions)
    ? slots.stock_query.part_descriptions
    : []
  let label =
    (turn.user?.text || '')
      .replace(/^\[👤[^\]]*\]\s*/, '')
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) || ''
  if (label.length > 90) label = label.slice(0, 90) + '…'
  const t0 = turn.user ? parseTs(turn.user.timestamp) : null
  const last = turn.answer ?? turn.nodes[turn.nodes.length - 1]?.e ?? turn.user
  const t1 = last ? parseTs(last.timestamp) : null
  const durS = t0 != null && t1 != null ? Math.max(0, (t1 - t0) / 1000) : null
  let status: TurnStatus = 'ok'
  for (const n of turn.nodes) {
    const s = nodeStatus(n.e, n.dur)
    if (s === 'err') { status = 'err'; break }
    if (s === 'slow') status = 'slow'
  }
  return { label, parts, durS, status }
}

/** "find_part vehicle='X' descs=['a','b'] via=portal-pilot source=native cached=True -> 2 schema(s)"
 *  parsed into fields for a readable bullet list; null when the note isn't in that shape. */
function parseFindPart(text: string) {
  const m = text.match(
    /^find_part vehicle='([^']*)' descs=\[(.*?)\] via=(\S+) source=(\S+) cached=(\S+) (?:→|->) (\d+) schema/
  )
  if (!m) return null
  const descs = m[2]
    .split(/,\s*/)
    .map((s) => s.replace(/^['"]|['"]$/g, '').trim())
    .filter(Boolean)
  return { vehicle: m[1], descs, via: m[3], source: m[4], cached: m[5], schemas: m[6] }
}

function FindPartBullets({ text }: { text: string }) {
  const fp = parseFindPart(text)
  if (!fp) return <EventBody text={text} />
  const mono = 'font-mono text-gray-200'
  return (
    <ul dir="ltr" className="list-disc space-y-0.5 ps-5 text-sm text-gray-300 marker:text-gray-600">
      <li>vehicle: <span className={mono}>{fp.vehicle || '—'}</span></li>
      <li>parts: <span className={mono}>{fp.descs.join(', ') || '—'}</span></li>
      <li>via: <span className={mono}>{fp.via}</span> · source: <span className={mono}>{fp.source}</span></li>
      <li>cached: <span className={mono}>{/true/i.test(fp.cached) ? 'yes' : /none/i.test(fp.cached) ? 'unknown' : 'no'}</span></li>
      <li>schemas found: <span className={mono}>{fp.schemas}</span></li>
    </ul>
  )
}

/** What each pipeline node does — shown in the node detail panel. */
const NODE_INFO: Record<string, string> = {
  Diego_Clone: 'Root router — reads the message and transfers to the right flow; owns the flow-teaching tools',
  JSP_Assistant: 'Root — regex fast-path (זיכוי/החזרה/תזכורת → dora_flow directly), otherwise the LLM router decides',
  jsp_router: 'LLM router (Gemini, Roy persona) — stock → stock_flow, credits/returns → dora_flow, feedback → feedback_flow',
  dora_flow: 'Dora — credits/returns, replacement cases, reminders, outgoing deliveries (hermes-agent relay on LXC 104)',
  extract_slots: 'Gemini extraction — vehicle (plate/VIN) + part descriptions in English from the conversation',
  search_parts: 'find_part via portal-pilot (PSA diagram scrape); finansit lambda only as transport fallback',
  enrich_parts: 'Best variant(s) per diagram + live stock & price per part from the ERP',
  lubinski_stock: 'Supplier (Lubinski importer) availability for parts with zero own stock',
  format_v2: 'Deterministic v2-style answer: header, flow line, part lines, diagrams',
  record_feedback: 'Stores 👍/👎 feedback on an answer',
  respond_feedback: 'Acknowledges the feedback to the customer',
}

/** A part from the enriched/lubinski state JSON — the structured source the answer text is
 *  rendered from. Rendering from state keeps the dashboard immune to message-format changes. */
interface EnrichedPart {
  pn: string
  name?: string
  num?: string | number
  conf?: number | null
  total?: number | null
  wh?: string
  price?: number | null
  stock_ok?: boolean
  lub_qty?: number
}

function PartCardFromState({ p, idx }: { p: EnrichedPart; idx: number }) {
  let stock: { text: string; cls?: string }
  if (p.stock_ok === false) stock = { text: 'לא ניתן לבדוק כרגע', cls: 'text-amber-400' }
  else if ((p.total || 0) > 0) stock = { text: `${p.total}${p.wh ? ` (מחסן ${p.wh})` : ''}` }
  else if ((p.lub_qty || 0) > 0)
    stock = { text: `אין אצלנו — זמין מהספק לובינסקי (${p.lub_qty}), הזמנה תוך יום עסקים`, cls: 'text-sky-400' }
  else stock = { text: 'אין במלאי', cls: 'text-red-400' }
  return (
    <div dir="rtl" className="my-1 rounded-lg border border-[var(--color-border-default)] bg-black/20 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-gray-500">#{idx}</span>
        <span dir="auto" className="text-sm font-medium text-gray-100">{p.name || p.pn}</span>
        {p.conf != null && <span className="text-[10px] text-gray-500">התאמה {p.conf}%</span>}
      </div>
      <ul className="mt-1 list-disc space-y-0.5 ps-5 text-sm text-gray-300 marker:text-gray-600">
        <li>מק״ט: <ItemLink code={p.pn} showCode /></li>
        {p.num != null && p.num !== '' && p.num !== '-' && (
          <li>מספר בשרטוט: <span className="font-mono text-gray-200">{p.num}</span></li>
        )}
        <li className={stock.cls}>במלאי: {stock.text}</li>
        {typeof p.price === 'number' && (
          <li>מחיר: <span className="font-mono text-gray-200">₪{p.price.toFixed(2)}</span></li>
        )}
      </ul>
    </div>
  )
}

/** Fullscreen in-page image viewer — arrow keys navigate, Escape closes.
 *  Same interaction as the credits scan modal, so the dashboard stays consistent. */
function ImageLightbox({
  images, index, caption, onClose, onNav,
}: {
  images: string[]
  index: number
  caption?: string
  onClose: () => void
  onNav: (i: number) => void
}) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
      else if (ev.key === 'ArrowRight') onNav(Math.min(index + 1, images.length - 1))
      else if (ev.key === 'ArrowLeft') onNav(Math.max(index - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, images.length, onClose, onNav])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal
    >
      <button
        onClick={onClose}
        className="absolute end-4 top-4 rounded-full bg-white/10 p-2 text-gray-200 hover:bg-white/20"
        title="Close (Esc)"
      >
        <X className="h-5 w-5" />
      </button>
      {index > 0 && (
        <button
          onClick={(ev) => { ev.stopPropagation(); onNav(index - 1) }}
          className="absolute start-4 rounded-full bg-white/10 p-2 text-gray-200 hover:bg-white/20"
          title="Previous (←)"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}
      {index < images.length - 1 && (
        <button
          onClick={(ev) => { ev.stopPropagation(); onNav(index + 1) }}
          className="absolute end-4 top-1/2 rounded-full bg-white/10 p-2 text-gray-200 hover:bg-white/20"
          title="Next (→)"
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}
      <figure className="max-h-full max-w-full" onClick={(ev) => ev.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={images[index]} alt="schema" className="max-h-[85vh] max-w-full rounded-lg object-contain" />
        <figcaption className="mt-2 text-center text-xs text-gray-400">
          {caption ? `${caption} · ` : ''}{index + 1}/{images.length}
        </figcaption>
      </figure>
    </div>
  )
}

type CardVariant = 'card' | 'user' | 'answer'

const VARIANT_WRAP: Record<CardVariant, string> = {
  card: 'rounded-lg border border-[var(--color-border-default)] bg-black/20 p-3',
  // customer bubble: end-aligned, blue — the WhatsApp mental model operators already have
  user: 'w-fit min-w-[240px] max-w-[85%] ms-auto rounded-2xl rounded-se-md border border-blue-500/25 bg-blue-500/10 p-3',
  // bot answer bubble: start-aligned, green-tinted
  answer: 'w-fit min-w-[280px] max-w-[95%] me-auto rounded-2xl rounded-ss-md border border-emerald-500/20 bg-emerald-500/[0.06] p-3',
}

/** One full event — a debug card (pipeline nodes) or a chat bubble (customer / final answer).
 *  `enriched` (the turn's part-state JSON) replaces the answer's raw part text-lines with
 *  structured cards. */
function EventCard({ e, enriched, variant = 'card' }: { e: DiegoEvent; enriched?: EnrichedPart[]; variant?: CardVariant }) {
  const [lightbox, setLightbox] = useState<number | null>(null)
  return (
    <div className={VARIANT_WRAP[variant]}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        {variant === 'user' ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-300">
            <User className="h-3.5 w-3.5" /> לקוח
          </span>
        ) : variant === 'answer' ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-300">
            <Bot className="h-3.5 w-3.5" /> {e.author === 'dora_flow' ? 'Dora' : 'Diego'}
          </span>
        ) : (
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
              NODE_COLORS[e.author] ?? 'bg-gray-500/15 text-gray-300 border-gray-500/30'
            }`}
          >
            {e.author}
          </span>
        )}
        {variant === 'card' && e.outputFor && (
          <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[11px] text-green-400">
            output
          </span>
        )}
        <span className="ml-auto text-[11px] text-gray-500" title={fmtDateTime(e.timestamp)}>
          {fmtTimeShort(e.timestamp)}
        </span>
      </div>
      {variant === 'card' && NODE_INFO[e.author] && (
        <div dir="ltr" className="mb-1.5 text-[11px] italic text-gray-500">{NODE_INFO[e.author]}</div>
      )}
      {(() => {
        const parts = (enriched ?? []).filter((p) => p?.pn)
        // With structured parts available, the raw '#N) ...' text lines are redundant.
        const bodyText = parts.length
          ? e.text.split('\n').filter((l) => !PART_LINE_RE.test(l.trim())).join('\n')
          : e.text
        return (
          <>
            {bodyText && (e.author === 'search_parts' ? <FindPartBullets text={bodyText} /> : <EventBody text={bodyText} />)}
            {parts.map((p, i) => (
              <PartCardFromState key={`${p.pn}-${i}`} p={p} idx={i + 1} />
            ))}
          </>
        )
      })()}
      {(e.toolEvents ?? []).length > 0 && (
        <div className="space-y-0.5">
          {e.toolEvents.map((t, j) => (
            <div key={j} dir="ltr" className="break-all font-mono text-xs text-purple-300/80">
              {t}
            </div>
          ))}
        </div>
      )}
      {e.images.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {e.images.map((u, i) => (
            <button key={u} onClick={() => setLightbox(i)} title="הגדל (חצים לניווט)">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="schema" className="h-32 rounded-md border border-gray-700 object-contain" />
            </button>
          ))}
        </div>
      )}
      {lightbox != null && (
        <ImageLightbox
          images={e.images}
          index={lightbox}
          caption={`${e.author} · ${fmtDateTime(e.timestamp)}`}
          onClose={() => setLightbox(null)}
          onNav={setLightbox}
        />
      )}
      {e.stateDelta && (
        <details className="mt-2" open={!e.text && !(e.toolEvents ?? []).length}>
          <summary className="cursor-pointer text-[11px] text-gray-400">
            State: {Object.keys(e.stateDelta).join(', ')}
          </summary>
          <pre className="mt-1 max-h-72 overflow-auto rounded bg-black/40 p-2 text-[11px] leading-4 text-gray-300">
            {JSON.stringify(e.stateDelta, null, 2)}
          </pre>
        </details>
      )}
      {e.raw != null && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-gray-500">Raw event JSON</summary>
          <pre className="mt-1 max-h-96 overflow-auto rounded bg-black/40 p-2 text-[11px] leading-4 text-gray-400">
            {JSON.stringify(e.raw, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}

/** The turn's intermediate node events as a horizontal clickable pipeline + a proportional
 *  latency bar ("where did the 40s go"); the open node's full EventCard renders below. */
function PipelineStrip({
  nodes, openId, onToggle, turnKey,
}: {
  nodes: TurnNode[]
  openId: string | null
  onToggle: (id: string) => void
  turnKey: number
}) {
  const nodeId = (n: TurnNode, i: number) => n.e.id || `t${turnKey}-n${i}`
  const open = nodes.find((n, i) => nodeId(n, i) === openId)
  const total = nodes.reduce((a, n) => a + (n.dur || 0), 0)
  return (
    <div className="space-y-2">
      {total > 0.5 && (
        <div className="flex items-center gap-2 px-0.5">
          <div className="flex h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
            {nodes.map((n, i) => {
              const id = nodeId(n, i)
              const st = nodeStatus(n.e, n.dur)
              return (
                <button
                  key={id}
                  onClick={() => onToggle(id)}
                  title={`${n.e.author} · ${fmtDur(n.dur)}`}
                  style={{ flexGrow: Math.max(n.dur || 0, total * 0.02) }}
                  className={`min-w-[6px] border-e border-black/40 last:border-e-0 ${TURN_STATUS_BAR[st]} ${
                    openId === id ? 'opacity-100' : 'opacity-70 hover:opacity-100'
                  }`}
                />
              )
            })}
          </div>
          <span className="shrink-0 font-mono text-[10px] text-gray-500">{fmtDur(total)}</span>
        </div>
      )}
      <div className="flex items-center gap-1 overflow-x-auto py-0.5">
        {nodes.map((n, i) => {
          const id = nodeId(n, i)
          const status = nodeStatus(n.e, n.dur)
          const badge = nodeBadge(n.e)
          const active = openId === id
          return (
            <span key={id} className="flex shrink-0 items-center gap-1">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-600" />}
              <button
                onClick={() => onToggle(id)}
                className={`flex flex-col items-start rounded-lg border px-2.5 py-1 text-left transition-colors ${
                  active
                    ? 'border-blue-500/60 bg-blue-500/10'
                    : 'border-[var(--color-border-default)] bg-black/20 hover:border-gray-500'
                }`}
                title={n.e.text || n.e.author}
              >
                <span className="font-mono text-[11px] font-semibold text-gray-200">{n.e.author}</span>
                <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${TURN_STATUS_DOT[status]}`} />
                  {fmtDur(n.dur)}
                  {badge && <span className="font-mono text-sky-400">{badge}</span>}
                </span>
              </button>
            </span>
          )
        })}
      </div>
      {open && (
        <div className="rounded-lg border border-blue-500/40 p-1">
          <EventCard e={open.e} />
        </div>
      )}
    </div>
  )
}

/** <details> with true default-open semantics: React never fights the user's toggles, and
 *  a matching #turn-N hash opens + scrolls to the turn (per-turn permalinks). */
function TurnGroup({
  anchorId, defaultOpen, className, summary, children,
}: {
  anchorId: string
  defaultOpen: boolean
  className?: string
  summary: ReactNode
  children: ReactNode
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const isTarget = typeof window !== 'undefined' && window.location.hash === `#${anchorId}`
    el.open = defaultOpen || isTarget
    if (isTarget) el.scrollIntoView({ block: 'start' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <details ref={ref} id={anchorId} className={className}>
      {summary}
      {children}
    </details>
  )
}

// ── health strip ─────────────────────────────────────────────────────────────

interface HealthData {
  services: { key: string; label: string; status: 'up' | 'down' }[]
  signals: {
    lastEventAgeMin: number | null
    turns24h: number
    errEvents24h: number
    avgAnswerSec: number | null
  } | null
}

/** "Is Diego answering right now?" — v3 stack pings + activity signals, refreshed every 60s. */
function HealthStrip() {
  const [h, setH] = useState<HealthData | null>(null)
  useEffect(() => {
    let dead = false
    const load = () =>
      fetch('/api/diego/health')
        .then((r) => r.json())
        .then((j) => { if (!dead && j.success) setH(j) })
        .catch(() => {})
    void load()
    const t = setInterval(load, 60_000)
    return () => { dead = true; clearInterval(t) }
  }, [])
  if (!h) return null
  const age = h.signals?.lastEventAgeMin
  const ageCls = age == null ? 'text-gray-500' : age > 240 ? 'text-red-400' : age > 60 ? 'text-amber-400' : 'text-gray-400'
  const errs = h.signals?.errEvents24h ?? 0
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[var(--color-border-default)] bg-black/20 px-3 py-1.5 text-[11px]">
      {h.services.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5 text-gray-300">
          <span className={`inline-block h-2 w-2 rounded-full ${s.status === 'up' ? 'bg-emerald-400' : 'bg-red-400'}`} />
          {s.label}
        </span>
      ))}
      {h.signals && (
        <>
          <span className="h-3 w-px bg-white/10" />
          <span className={ageCls}>
            {age == null ? 'אין אירועים' : age < 1 ? 'אירוע אחרון: עכשיו' : `אירוע אחרון לפני ${age} דק׳`}
          </span>
          <span className="text-gray-400">{h.signals.turns24h} פניות/24ש</span>
          <span className={errs > 0 ? 'text-red-400' : 'text-gray-500'}>{errs} שגיאות/24ש</span>
          {h.signals.avgAnswerSec != null && (
            <span className="text-gray-400">מענה ממוצע {h.signals.avgAnswerSec}s</span>
          )}
        </>
      )}
    </div>
  )
}

// ── per-turn debug actions ───────────────────────────────────────────────────

interface TurnVehicle { year?: number; model?: string; fuelType?: string; engineModel?: string }

function vehicleFromState(state: Record<string, unknown> | undefined): TurnVehicle | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx: any = (state as { search?: { vehicle_ctx?: unknown } })?.search?.vehicle_ctx
  if (!ctx || typeof ctx !== 'object') return null
  const year = ctx.year != null && /^\d{4}$/.test(String(ctx.year)) ? Number(ctx.year) : undefined
  return {
    year,
    model: ctx.model ?? ctx.tradeName ?? undefined,
    fuelType: ctx.fuelType ?? undefined,
    engineModel: ctx.engineModel ?? undefined,
  }
}

/** Session ids are VINs, except WA sessions keyed by a 7-8 digit license plate. */
function vehicleIdParam(sessionId: string): ['license_plate' | 'vin', string] {
  return /^\d{7,8}$/.test(sessionId) ? ['license_plate', sessionId] : ['vin', sessionId]
}

function observatoryHref(desc: string, sessionId: string, v: TurnVehicle | null): string {
  const p = new URLSearchParams({ query: desc })
  const [k, val] = vehicleIdParam(sessionId)
  p.set(k, val)
  if (v?.year) p.set('year', String(v.year))
  if (v?.model) p.set('model', v.model)
  if (v?.fuelType) p.set('fuel', v.fuelType)
  if (v?.engineModel) p.set('engine', v.engineModel)
  return `/chat/flow-decisions/observatory?${p.toString()}`
}

function createRuleHref(desc: string, v: TurnVehicle | null): string {
  const p = new URLSearchParams({ create: '1', seed: desc })
  if (v?.year) { p.set('yearFrom', String(v.year)); p.set('yearTo', String(v.year)) }
  if (v?.model) p.set('model', v.model)
  if (v?.fuelType) p.set('fuel', v.fuelType)
  if (v?.engineModel) p.set('engine', v.engineModel)
  return `/chat/flow-decisions?${p.toString()}`
}

const RULE_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

interface RecheckState { loading?: boolean; prodId?: string | null; same?: boolean; error?: string }

const ACTION_BTN =
  'inline-flex items-center gap-1 rounded-md border border-[var(--color-border-default)] px-2 py-1 text-[11px] text-gray-300 transition-colors hover:bg-white/5 hover:text-white'

/** The find → diagnose → fix → verify toolbar for one turn: trace the decision in the
 *  Observatory, re-run against the CURRENT rules ("did my fix work?"), seed a new rule
 *  from this exact turn (vehicle filters included). */
function TurnActions({
  desc, sessionId, vehicle, recordedRuleId, recheck, onRecheck,
}: {
  desc: string
  sessionId: string
  vehicle: TurnVehicle | null
  recordedRuleId: string | null
  recheck: RecheckState | undefined
  onRecheck: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <a href={observatoryHref(desc, sessionId, vehicle)} target="_blank" rel="noreferrer" className={ACTION_BTN}
         title="פתח את ההחלטה במצפה — למה נבחר החוק הזה?">
        <Radar className="h-3.5 w-3.5 text-sky-400" /> Trace decision
      </a>
      <button onClick={onRecheck} disabled={recheck?.loading} className={ACTION_BTN}
              title="הרץ מחדש מול החוקים הנוכחיים — האם התיקון שלי שינה את התוצאה?">
        <CheckCheck className="h-3.5 w-3.5 text-emerald-400" />
        {recheck?.loading ? 'בודק…' : 'Re-check vs rules'}
      </button>
      {recheck && !recheck.loading && (
        recheck.error ? (
          <span className="text-[11px] text-red-400">{recheck.error}</span>
        ) : recheck.same ? (
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
            אותו חוק נבחר
          </span>
        ) : recheck.prodId ? (
          <a href={`/chat/flow-decisions?q=${recheck.prodId}`} target="_blank" rel="noreferrer"
             className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] text-amber-300 hover:underline">
            עכשיו נבחר #{recheck.prodId.slice(0, 8)}
          </a>
        ) : (
          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
            אין חוק תואם כעת
          </span>
        )
      )}
      {recordedRuleId && (
        <span className="font-mono text-[10px] text-gray-600" title="החוק שנבחר בשיחה המקורית">
          then: #{recordedRuleId.slice(0, 8)}
        </span>
      )}
      <a href={createRuleHref(desc, vehicle)} target="_blank" rel="noreferrer" className={ACTION_BTN}
         title="צור חוק זרימה חדש מהפנייה הזו — כולל פילטרי הרכב">
        <Plus className="h-3.5 w-3.5 text-indigo-400" /> Rule from turn
      </a>
    </div>
  )
}

// ── main component ───────────────────────────────────────────────────────────

export default function DiegoSessionsTab() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [detail, setDetail] = useState<{ key: string; events: DiegoEvent[]; state: Record<string, unknown> } | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // which pipeline node's detail panel is open (event id; one at a time)
  const [openNode, setOpenNode] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [recheck, setRecheck] = useState<Record<string, RecheckState>>({})

  // The URL is the single source of truth for filter + selection — changing path
  // segments remounts the page (Next.js), so component state would be wiped.
  //   /chat/diego/<user>            — filter by user
  //   /chat/diego/<user>/<session>  — filter + open that trace
  //   /chat/diego?u=<user>&s=<id>   — open a trace with NO list filter (in-UI click)
  //   ?q=<text>                     — free-text search (also a FixQueue deep-link target)
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const segs = useMemo(
    () => pathname.split('/').filter(Boolean).slice(2).map(decodeURIComponent),
    [pathname]
  )
  const userFilter = segs[0] ?? null
  const selected = useMemo(() => {
    if (segs.length >= 2) return { user: normalizeUser(segs[0]), id: segs[1] }
    const s = searchParams.get('s')
    const u = searchParams.get('u')
    return s && u ? { user: normalizeUser(u), id: s } : null
  }, [segs, searchParams])

  const [q, setQ] = useState(() => searchParams.get('q') ?? '')
  const [days, setDays] = useState<number | null>(null)

  // Separate Dora sessions from Diego sessions: classify by which flow the
  // session's events actually used (a session can be both — shows in both).
  // "issues" turns the list into a triage inbox (errors / customers left hanging).
  const [flowFilter, setFlowFilter] = useState<'all' | 'diego' | 'dora' | 'issues'>('all')

  // ?flow=diego|dora scopes the TRACE to one flow's turns — a VIN session holds both
  // flows, so this is what makes "share this session as Diego" / "as Dora" links possible.
  const flowParam = searchParams.get('flow')
  const traceFlow: 'diego' | 'dora' | null =
    flowParam === 'diego' || flowParam === 'dora' ? flowParam : null

  const setTraceFlow = useCallback((f: 'diego' | 'dora' | null) => {
    const url = new URL(window.location.href)
    if (f) url.searchParams.set('flow', f)
    else url.searchParams.delete('flow')
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  }, [])

  const withQ = useCallback(
    (url: string) => {
      if (!q.trim()) return url
      return url + (url.includes('?') ? '&' : '?') + `q=${encodeURIComponent(q.trim())}`
    },
    [q]
  )

  const pickSession = useCallback(
    (user: string, id: string, flow?: 'diego' | 'dora') => {
      let url = withQ(
        userFilter
          ? `/chat/diego/${encodeURIComponent(userFilter)}/${encodeURIComponent(id)}`
          : `/chat/diego?u=${encodeURIComponent(user)}&s=${encodeURIComponent(id)}`
      )
      // opening from a flow-filtered list (or a flow badge) scopes the trace the same way
      const f = flow ?? (flowFilter === 'diego' || flowFilter === 'dora' ? flowFilter : undefined)
      if (f) url += (url.includes('?') ? '&' : '?') + `flow=${f}`
      window.history.replaceState(null, '', url)
    },
    [userFilter, withQ, flowFilter]
  )

  const applyUserFilter = useCallback(
    (user: string | null) => {
      const url = !user
        ? selected
          ? `/chat/diego?u=${encodeURIComponent(selected.user)}&s=${encodeURIComponent(selected.id)}`
          : '/chat/diego'
        : selected && sameUser(user, selected.user)
          ? `/chat/diego/${encodeURIComponent(user)}/${encodeURIComponent(selected.id)}`
          : `/chat/diego/${encodeURIComponent(user)}`
      window.history.replaceState(null, '', withQ(url))
    },
    [selected, withQ]
  )

  const listParams = useCallback(
    (offset: number) => {
      const p = new URLSearchParams()
      if (q.trim()) p.set('q', q.trim())
      if (days) p.set('days', String(days))
      if (offset) p.set('offset', String(offset))
      return p.toString()
    },
    [q, days]
  )

  const loadList = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!opts.silent) setLoading(true)
      try {
        const r = await fetch(`/api/diego/sessions?${listParams(0)}`)
        const j = await r.json()
        if (!j.success) throw new Error(j.error)
        setSessions(j.sessions)
        setHasMore(!!j.hasMore)
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [listParams]
  )

  const loadMore = useCallback(async () => {
    setLoadingMore(true)
    try {
      const r = await fetch(`/api/diego/sessions?${listParams(sessions.length)}`)
      const j = await r.json()
      if (!j.success) throw new Error(j.error)
      setSessions((prev) => [...prev, ...j.sessions])
      setHasMore(!!j.hasMore)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingMore(false)
    }
  }, [listParams, sessions.length])

  // search + date filter are debounced into one list reload
  useEffect(() => {
    const t = setTimeout(() => void loadList(), 350)
    return () => clearTimeout(t)
  }, [loadList])

  // live tail: poll the list every 10s, the open trace every 7s (silent — no spinners)
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => void loadList({ silent: true }), 10_000)
    return () => clearInterval(t)
  }, [live, loadList])

  // detail-loading is DERIVED (selected ≠ loaded key), so the effect never sets state synchronously
  const selKey = selected ? `${selected.user}/${selected.id}` : null
  const loadingDetail = !!selKey && detail?.key !== selKey

  const loadDetail = useCallback(async () => {
    if (!selected) return
    const key = `${selected.user}/${selected.id}`
    try {
      const r = await fetch(
        `/api/diego/sessions?user=${encodeURIComponent(selected.user)}&id=${encodeURIComponent(selected.id)}`
      )
      const j = await r.json()
      if (j.success) setDetail({ key, events: j.session.events, state: j.session.state ?? {} })
      else setError(j.error)
    } catch (e) {
      setError(String(e))
    }
  }, [selected])

  useEffect(() => {
    if (!selected) return
    let dead = false
    void (async () => {
      if (!dead) await loadDetail()
    })()
    return () => { dead = true }
  }, [selected, loadDetail])

  useEffect(() => {
    if (!live || !selected) return
    const t = setInterval(() => void loadDetail(), 7_000)
    return () => clearInterval(t)
  }, [live, selected, loadDetail])

  const selectedSummary = useMemo(
    () => sessions.find((s) => s.userId === selected?.user && s.sessionId === selected?.id),
    [sessions, selected]
  )

  const visibleSessions = useMemo(() => {
    let list = userFilter ? sessions.filter((s) => sameUser(userFilter, s.userId)) : sessions
    if (flowFilter === 'dora') list = list.filter((s) => (s.doraEvents ?? 0) > 0)
    if (flowFilter === 'diego') list = list.filter((s) => (s.stockEvents ?? 0) > 0 || (s.doraEvents ?? 0) === 0)
    if (flowFilter === 'issues') list = list.filter((s) => (s.errEvents ?? 0) > 0 || s.unanswered)
    return list
  }, [sessions, userFilter, flowFilter])

  const issueCount = useMemo(
    () => sessions.filter((s) => (s.errEvents ?? 0) > 0 || s.unanswered).length,
    [sessions]
  )

  const deleteSession = useCallback(async (user: string, id: string) => {
    if (!window.confirm(`למחוק את הסשן ${id} לצמיתות?`)) return
    try {
      const r = await fetch(
        `/api/diego/sessions?user=${encodeURIComponent(user)}&id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      )
      const j = await r.json()
      if (!j.success) throw new Error(j.error)
      setSessions((prev) => prev.filter((s) => !(s.userId === user && s.sessionId === id)))
      if (selected && selected.id === id && sameUser(selected.user, user)) {
        setDetail(null)
        window.history.replaceState(null, '', userFilter ? `/chat/diego/${encodeURIComponent(userFilter)}` : '/chat/diego')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [selected, userFilter])

  const distinctUsers = useMemo(() => {
    const byId = new Map<string, { count: number; name: string | null }>()
    for (const s of sessions) {
      const e = byId.get(s.userId) ?? { count: 0, name: s.customerName }
      e.count += 1
      if (!e.name && s.customerName) e.name = s.customerName
      byId.set(s.userId, e)
    }
    return [...byId.entries()]
      .map(([id, { count, name }]) => ({ id, count, name }))
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
  }, [sessions])

  // the URL segment may be the bare code ("32722") while the stored id is padded
  const filterSelectValue = userFilter ? distinctUsers.find((u) => sameUser(userFilter, u.id))?.id ?? userFilter : ''

  const sessionVehicle = useMemo(() => vehicleFromState(detail?.state), [detail?.state])

  // Turns annotated with their flow + stable numbering (permalinks #turn-N never shift
  // when the trace is scoped to one flow).
  const turnData = useMemo(() => {
    if (!detail) return null
    const annotated = groupTurns(detail.events).map((turn, i) => ({
      turn,
      no: i + 1,
      flow:
        turn.answer?.author === 'dora_flow' || turn.nodes.some((n) => n.e.author === 'dora_flow')
          ? ('dora' as const)
          : ('diego' as const),
    }))
    return {
      annotated,
      hasBoth: annotated.some((x) => x.flow === 'dora') && annotated.some((x) => x.flow === 'diego'),
    }
  }, [detail])

  const runRecheck = useCallback(
    async (turnKey: string, desc: string, recordedRuleId: string | null) => {
      if (!selected) return
      setRecheck((prev) => ({ ...prev, [turnKey]: { loading: true } }))
      try {
        const [idKey, idVal] = vehicleIdParam(selected.id)
        const r = await fetch('/api/flow-decisions/trace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            partDescription: desc,
            vehicleData: sessionVehicle ?? {},
            [idKey === 'license_plate' ? 'licensePlate' : 'vin']: idVal,
          }),
        })
        const j = await r.json()
        if (j.error) throw new Error(j.details || j.error)
        const prodId: string | null = j.productionId ?? null
        setRecheck((prev) => ({
          ...prev,
          [turnKey]: {
            prodId,
            same: !!prodId && !!recordedRuleId && prodId.toLowerCase() === recordedRuleId.toLowerCase(),
          },
        }))
      } catch (e) {
        setRecheck((prev) => ({
          ...prev,
          [turnKey]: { error: e instanceof Error ? e.message : String(e) },
        }))
      }
    },
    [selected, sessionVehicle]
  )

  return (
    <div className="space-y-3">
      <HealthStrip />
      {/* minmax(0,1fr): a plain 1fr column refuses to shrink below its content
          (long mono lines / JSON blocks), pushing the page under the fixed sidebar. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      {/* ---- session list ---- */}
      <Panel
        title={`Sessions (${visibleSessions.length}${userFilter ? ` / ${sessions.length}` : ''})`}
        subtitle="One session per car — id is the VIN, user is the customer code"
        icon={<Car className="h-4 w-4" />}
        action={
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setLive((v) => !v)}
              className={`rounded-md border p-1.5 transition-colors ${
                live
                  ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-400'
                  : 'border-[var(--color-border-default)] text-gray-400 hover:text-white'
              }`}
              title={live ? 'Live tail on — polling every 10s' : 'Live tail off'}
            >
              <Radio className={`h-4 w-4 ${live ? 'animate-pulse' : ''}`} />
            </button>
            <button
              onClick={() => void loadList()}
              className="rounded-md border border-[var(--color-border-default)] p-1.5 text-gray-400 hover:text-white"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        }
      >
        {error && <div className="mb-2 rounded bg-red-500/10 p-2 text-xs text-red-400">{error}</div>}
        {/* free-text search: VIN / plate / customer / vehicle / any message text */}
        <div className="mb-2 flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
            <input
              value={q}
              onChange={(ev) => setQ(ev.target.value)}
              dir="auto"
              placeholder="חיפוש: טקסט הודעה, לוחית, VIN, דגם…"
              className="w-full rounded-md border border-[var(--color-border-default)] bg-black/30 py-1.5 ps-7 pe-7 text-xs text-gray-200 placeholder:text-gray-600 focus:border-blue-500/60 focus:outline-none"
            />
            {q && (
              <button
                onClick={() => setQ('')}
                className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-500 hover:text-white"
                title="נקה חיפוש"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <select
            value={days ?? ''}
            onChange={(ev) => setDays(ev.target.value ? Number(ev.target.value) : null)}
            className="shrink-0 rounded-md border border-[var(--color-border-default)] bg-black/30 px-1.5 py-1.5 text-xs text-gray-300 focus:outline-none"
            title="טווח זמן"
          >
            <option value="">כל הזמן</option>
            <option value="1">24 שעות</option>
            <option value="7">שבוע</option>
            <option value="30">חודש</option>
          </select>
        </div>
        <div className="mb-2 flex items-center gap-2">
          <User className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <select
            value={filterSelectValue}
            onChange={(ev) => applyUserFilter(ev.target.value || null)}
            className="min-w-0 flex-1 rounded-md border border-[var(--color-border-default)] bg-black/30 px-2 py-1.5 font-mono text-xs text-gray-200 focus:border-blue-500/60 focus:outline-none"
            title="Filter sessions by user"
          >
            <option value="">All users ({sessions.length})</option>
            {distinctUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ? `${u.name} (${customerCode(u.id) ?? u.id})` : customerCode(u.id) ?? u.id} · {u.count}
              </option>
            ))}
          </select>
          {userFilter && (
            <button
              onClick={() => applyUserFilter(null)}
              className="rounded-md border border-[var(--color-border-default)] p-1.5 text-gray-400 hover:text-white"
              title="Clear user filter"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <div className="flex gap-1">
            {([['all', 'הכל'], ['diego', 'Diego'], ['dora', 'Dora'], ['issues', `⚠ ${issueCount}`]] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFlowFilter(key)}
                className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                  flowFilter === key
                    ? key === 'dora'
                      ? 'border-rose-500/60 bg-rose-500/10 text-rose-300'
                      : key === 'issues'
                        ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
                        : 'border-blue-500/60 bg-blue-500/10 text-blue-300'
                    : 'border-[var(--color-border-default)] text-gray-400 hover:text-white'
                }`}
                title={key === 'issues' ? 'רק סשנים עם שגיאות או לקוח ללא מענה' : undefined}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[75vh] space-y-2 overflow-y-auto pe-1">
          {visibleSessions.map((s) => {
            const active = selected?.user === s.userId && selected?.id === s.sessionId
            const cust = customerCode(s.userId)
            const health: TurnStatus | null = (s.errEvents ?? 0) > 0 ? 'err' : s.unanswered ? 'slow' : null
            return (
              <div
                key={`${s.userId}/${s.sessionId}`}
                role="button"
                tabIndex={0}
                onClick={() => pickSession(s.userId, s.sessionId)}
                onKeyDown={(ev) => ev.key === 'Enter' && pickSession(s.userId, s.sessionId)}
                className={`w-full cursor-pointer rounded-lg border p-3 text-left transition-colors ${
                  active
                    ? 'border-blue-500/60 bg-blue-500/10'
                    : 'border-[var(--color-border-default)] bg-black/20 hover:border-gray-500'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {health && (
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${TURN_STATUS_DOT[health]}`}
                        title={health === 'err' ? `${s.errEvents} שגיאות בסשן` : 'הודעה אחרונה ללא מענה'}
                      />
                    )}
                    <span className="truncate font-mono text-sm text-white">{s.sessionId}</span>
                    {/* clicking a flow badge opens the trace scoped to that flow only */}
                    {(s.stockEvents ?? 0) > 0 && (
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation()
                          pickSession(s.userId, s.sessionId, 'diego')
                        }}
                        className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-1.5 text-[10px] text-cyan-300 hover:bg-cyan-500/20"
                        title="פתח רק את פניות המלאי (Diego) בסשן"
                      >
                        diego
                      </button>
                    )}
                    {(s.doraEvents ?? 0) > 0 && (
                      <button
                        onClick={(ev) => {
                          ev.stopPropagation()
                          pickSession(s.userId, s.sessionId, 'dora')
                        }}
                        className="rounded-full border border-rose-500/30 bg-rose-500/10 px-1.5 text-[10px] text-rose-300 hover:bg-rose-500/20"
                        title="פתח רק את פניות הזיכויים/החזרות (Dora) בסשן"
                      >
                        dora
                      </button>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="text-[11px] text-gray-500" title={fmtDateTime(s.updateTime)}>
                      {relTime(s.updateTime)}
                    </span>
                    <button
                      onClick={(ev) => {
                        ev.stopPropagation()
                        void deleteSession(s.userId, s.sessionId)
                      }}
                      className="rounded p-0.5 text-gray-600 hover:bg-red-500/15 hover:text-red-400"
                      title="מחק סשן"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                  <User className="h-3 w-3" />
                  {cust ? (
                    <span onClick={(ev) => ev.stopPropagation()}>
                      <CustomerLink code={cust} showCode className="font-mono text-xs" />
                    </span>
                  ) : (
                    <span className="font-mono">{s.userId}</span>
                  )}
                  {s.customerName && (
                    <span dir="rtl" className="max-w-[140px] truncate text-gray-300" title={s.customerName}>
                      {s.customerName}
                    </span>
                  )}
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation()
                      applyUserFilter(s.userId)
                    }}
                    className="rounded p-0.5 text-gray-500 hover:bg-white/10 hover:text-white"
                    title={`Show only ${cust ?? s.userId}'s sessions`}
                  >
                    <ListFilter className="h-3 w-3" />
                  </button>
                  <span>· {s.turns} turns</span>
                  <span>· {s.events} events</span>
                </div>
                {s.vehicle && <div className="mt-1 text-xs text-gray-300" dir="rtl">{s.vehicle}</div>}
                {s.lastUserText && (
                  <div className="mt-1 truncate text-xs text-gray-500" dir="auto">
                    {s.lastUserText}
                  </div>
                )}
              </div>
            )
          })}
          {!loading && visibleSessions.length === 0 && (
            <div className="p-4 text-center text-sm text-gray-500">
              {q ? `אין תוצאות ל"${q}"` : userFilter ? `No sessions for user ${userFilter}` : 'No sessions yet'}
            </div>
          )}
          {hasMore && (
            <button
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="w-full rounded-lg border border-dashed border-[var(--color-border-default)] p-2 text-xs text-gray-400 hover:text-white"
            >
              {loadingMore ? 'טוען…' : 'טען עוד'}
            </button>
          )}
        </div>
      </Panel>

      {/* ---- timeline ---- */}
      <Panel
        title={selected ? `${selected.id}` : 'Conversation trace'}
        subtitle={
          selectedSummary?.vehicle ??
          (selected ? `user ${selected.user}` : 'Select a session to see the full turn-by-turn trace')
        }
        icon={<Bot className="h-4 w-4" />}
        action={
          selected ? (
            <div className="flex items-center gap-2">
              {selectedSummary?.customerName && (
                <span dir="rtl" className="max-w-[180px] truncate text-xs text-gray-300" title={selectedSummary.customerName}>
                  {selectedSummary.customerName}
                </span>
              )}
              {customerCode(selected.user) && (
                <CustomerLink code={customerCode(selected.user)!} showCode className="font-mono text-xs" />
              )}
              <a
                href={`${ADK_WEB}/dev-ui/?app=diego_v3&userId=${encodeURIComponent(selected.user)}&session=${encodeURIComponent(selected.id)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 rounded-md border border-[var(--color-border-default)] px-2 py-1 text-xs text-gray-300 hover:text-white"
              >
                adk web <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          ) : undefined
        }
      >
        {loadingDetail && <div className="p-6 text-center text-sm text-gray-500">Loading…</div>}
        {!loadingDetail && detail && turnData && (
          <>
            {/* a VIN session mixes Diego (stock) and Dora (credits) turns — these chips scope
                the trace to one flow, and the scope lives in the URL (?flow=) so a "Diego view"
                or "Dora view" of the SAME session is a shareable link */}
            {(turnData.hasBoth || traceFlow) && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="text-gray-500">שיחה משולבת — הצג:</span>
                {([
                  ['all', `הכל · ${turnData.annotated.length}`],
                  ['diego', `Diego · ${turnData.annotated.filter((x) => x.flow === 'diego').length}`],
                  ['dora', `Dora · ${turnData.annotated.filter((x) => x.flow === 'dora').length}`],
                ] as const).map(([key, label]) => {
                  const active = key === 'all' ? traceFlow === null : traceFlow === key
                  return (
                    <button
                      key={key}
                      onClick={() => setTraceFlow(key === 'all' ? null : key)}
                      className={`rounded-md border px-2 py-0.5 transition-colors ${
                        active
                          ? key === 'dora'
                            ? 'border-rose-500/60 bg-rose-500/10 text-rose-300'
                            : key === 'diego'
                              ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-300'
                              : 'border-blue-500/60 bg-blue-500/10 text-blue-300'
                          : 'border-[var(--color-border-default)] text-gray-400 hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
          <div className="max-h-[75vh] space-y-4 overflow-y-auto pe-1">
            {/* newest turn first; each turn is a collapsible group — latest open, older
                ones fold to a one-line summary (query · status · duration · time) */}
            {(() => {
              const rendered = (traceFlow
                ? turnData.annotated.filter((x) => x.flow === traceFlow)
                : turnData.annotated
              ).slice().reverse()
              let prevDay: string | null = null
              return rendered.map(({ turn, no: turnNo, flow }, ti) => {
                const s = turnSummary(turn)
                const anchorId = `turn-${turnNo}`
                const turnKey = turn.user?.id || anchorId
                // Latest part-state in the turn (lubinski_stock re-emits enriched with lub_qty
                // after enrich_parts) — the answer renders its part cards from this JSON.
                const enriched = [...turn.nodes].reverse()
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  .map((n) => (n.e.stateDelta as any)?.enriched)
                  .find((x) => Array.isArray(x) && x.length)
                const recordedRuleId = turn.answer?.text.match(RULE_UUID)?.[0] ?? null
                const ts = turn.user?.timestamp ?? turn.nodes[0]?.e.timestamp
                const day = ts ? dayKey(ts) : prevDay
                const showDay = day !== prevDay && ts
                prevDay = day
                return (
                  <div key={turnKey} className="space-y-4">
                    {showDay && (
                      <div className="flex items-center gap-3">
                        <span className="h-px flex-1 bg-white/5" />
                        <span dir="rtl" className="rounded-full border border-[var(--color-border-default)] bg-black/30 px-2.5 py-0.5 text-[11px] text-gray-500">
                          {fmtDayLabel(ts!)}
                        </span>
                        <span className="h-px flex-1 bg-white/5" />
                      </div>
                    )}
                    <TurnGroup
                      anchorId={anchorId}
                      defaultOpen={ti === 0}
                      className="group rounded-xl border border-[var(--color-border-default)] bg-black/10"
                      summary={
                        <summary className="sticky top-0 z-[5] flex cursor-pointer select-none flex-wrap items-center gap-2 rounded-xl bg-[var(--color-bg-elevated,#1b1b1f)] px-3 py-2 text-sm group-open:rounded-b-none group-open:border-b group-open:border-[var(--color-border-default)] [&::-webkit-details-marker]:hidden">
                          <ChevronRight className="h-4 w-4 shrink-0 text-gray-500 transition-transform group-open:rotate-90" />
                          <span className="font-mono text-[11px] text-gray-600">#{turnNo}</span>
                          <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${TURN_STATUS_DOT[s.status]}`} />
                          {turnData.hasBoth && !traceFlow && (
                            <span
                              className={`rounded-full border px-1.5 text-[10px] ${
                                flow === 'dora'
                                  ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                                  : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
                              }`}
                            >
                              {flow}
                            </span>
                          )}
                          {s.parts.length > 0 ? (
                            <>
                              <span dir="ltr" className="font-medium text-gray-200">🔎 {s.parts.join(' · ')}</span>
                              {s.label && (
                                <span dir="auto" className="max-w-[280px] truncate text-xs text-gray-500">{s.label}</span>
                              )}
                            </>
                          ) : (
                            <span dir="auto" className="max-w-[420px] truncate font-medium text-gray-200">{s.label || '—'}</span>
                          )}
                          <span className="ms-auto flex items-center gap-2 text-[11px] text-gray-500">
                            {s.durS != null && <span className="font-mono">{fmtDur(s.durS)}</span>}
                            {turn.user && (
                              <span title={fmtDateTime(turn.user.timestamp)}>{fmtTimeShort(turn.user.timestamp)}</span>
                            )}
                            <button
                              onClick={(ev) => {
                                ev.preventDefault()
                                ev.stopPropagation()
                                const base = selected
                                  ? `${window.location.origin}/chat/diego/${encodeURIComponent(selected.user)}/${encodeURIComponent(selected.id)}`
                                  : window.location.origin + window.location.pathname
                                // keep the flow scope in the shared link (Diego-view vs Dora-view)
                                void copyText(`${base}${traceFlow ? `?flow=${traceFlow}` : ''}#${anchorId}`)
                                toast.success('קישור לפנייה הועתק')
                              }}
                              className="rounded p-0.5 text-gray-600 hover:bg-white/10 hover:text-white"
                              title="העתק קישור ישיר לפנייה זו"
                            >
                              <Link2 className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        </summary>
                      }
                    >
                      <div className="space-y-2 p-3">
                        {s.parts.length > 0 && selected && (
                          <TurnActions
                            desc={s.parts[0]}
                            sessionId={selected.id}
                            vehicle={sessionVehicle}
                            recordedRuleId={recordedRuleId}
                            recheck={recheck[turnKey]}
                            onRecheck={() => void runRecheck(turnKey, s.parts[0], recordedRuleId)}
                          />
                        )}
                        {turn.user && <EventCard e={turn.user} variant="user" />}
                        {turn.nodes.length > 0 && (
                          <PipelineStrip
                            nodes={turn.nodes}
                            openId={openNode}
                            onToggle={(id) => setOpenNode(openNode === id ? null : id)}
                            turnKey={ti}
                          />
                        )}
                        {turn.answer && <EventCard e={turn.answer} enriched={enriched} variant="answer" />}
                      </div>
                    </TurnGroup>
                  </div>
                )
              })
            })()}
            {detail.events.length === 0 && (
              <div className="p-6 text-center text-sm text-gray-500">No events in this session</div>
            )}
            {detail.events.length > 0 &&
              traceFlow &&
              turnData.annotated.every((x) => x.flow !== traceFlow) && (
                <div className="p-6 text-center text-sm text-gray-500">
                  אין פניות {traceFlow === 'dora' ? 'Dora' : 'Diego'} בסשן הזה
                </div>
              )}
          </div>
          </>
        )}
        {!loadingDetail && !detail && !selected && (
          <div className="p-10 text-center text-sm text-gray-500">← Pick a car session</div>
        )}
      </Panel>
      </div>
    </div>
  )
}
