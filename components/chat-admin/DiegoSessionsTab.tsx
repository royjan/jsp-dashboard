'use client'

/**
 * Diego v3 (ADK) sessions browser — session list (one per car/VIN) + full turn-by-turn
 * trace: customer messages, per-node outputs (state deltas), schema diagrams, final answers.
 * Read-only over the diego_v3 schema via /api/diego/sessions.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Bot, Car, ChevronRight, ExternalLink, ListFilter, RefreshCw, User, X } from 'lucide-react'
import { Panel } from '@/components/chat-admin/Panel'
import { CustomerLink } from '@/components/shared/CustomerLink'
import { ItemLink } from '@/components/shared/ItemLink'

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
}

const AUTHOR_STYLE: Record<string, string> = {
  user: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  Diego_Clone: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  JSP_Assistant: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  extract_slots: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  search_parts: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  enrich_parts: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  lubinski_stock: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  dora_flow: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  format_v2: 'bg-green-500/15 text-green-300 border-green-500/30',
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

const FLOW_ID = /(#[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g

/** One line of bot/customer text: natural direction per line, URLs become real links —
 *  item codes get the customers-page hover card (ItemLink), the 🧭 flow line's #<uuid>
 *  links the exact flow_decisions_v2 row, other URLs get a shortened label. */
function LinkifiedLine({ line }: { line: string }) {
  const parts = line.split(URL_SPLIT)
  return (
    <div dir="auto" className="whitespace-pre-wrap break-words">
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
        if (!line.includes('החלטת זרימה')) return <span key={i}>{p}</span>
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
 *  links; bare image-URL lines are dropped (the diagram renders below anyway). */
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
    <div className="space-y-0.5 text-sm text-gray-200">
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

function fmtTime(ts: string) {
  try {
    return new Date(ts + (ts.endsWith('Z') ? '' : 'Z')).toLocaleString('he-IL', {
      dateStyle: 'short',
      timeStyle: 'medium',
    })
  } catch {
    return ts
  }
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
    const idx = t.nodes.map((n) => !!n.e.outputFor).lastIndexOf(true)
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

function nodeStatus(e: DiegoEvent, dur: number | null): 'ok' | 'slow' | 'err' {
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

const STATUS_DOT: Record<string, string> = {
  ok: 'bg-emerald-400',
  slow: 'bg-amber-400',
  err: 'bg-red-400',
}

/** Header line for a collapsed turn: what was searched, how it went, how long it took. */
function turnSummary(turn: Turn) {
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
  let status: 'ok' | 'slow' | 'err' = 'ok'
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
  JSP_Assistant: 'Root router (Jan Spare Parts assistant) — stock → stock_flow, credits/returns/reminders/deliveries → dora_flow, feedback → feedback_flow',
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

/** One full event rendered as a card — used for user messages, final answers, and the
 *  opened node detail panel. `enriched` (the turn's part-state JSON) replaces the answer's
 *  raw part text-lines with structured cards. */
function EventCard({ e, enriched }: { e: DiegoEvent; enriched?: EnrichedPart[] }) {
  return (
    <div className="rounded-lg border border-[var(--color-border-default)] bg-black/20 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            AUTHOR_STYLE[e.author] ?? 'bg-gray-500/15 text-gray-300 border-gray-500/30'
          }`}
        >
          {e.author}
        </span>
        {e.outputFor && (
          <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[11px] text-green-400">
            output
          </span>
        )}
        <span className="ml-auto text-[11px] text-gray-500">{fmtTime(e.timestamp)}</span>
      </div>
      {NODE_INFO[e.author] && (
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
          {e.images.map((u) => (
            <a key={u} href={u} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt="schema" className="h-32 rounded-md border border-gray-700 object-contain" />
            </a>
          ))}
        </div>
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
    </div>
  )
}

/** The turn's intermediate node events as a horizontal clickable pipeline; the open
 *  node's full EventCard renders right below the strip. */
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
  return (
    <div className="space-y-2">
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
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
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

export default function DiegoSessionsTab() {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [detail, setDetail] = useState<{ key: string; events: DiegoEvent[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // which pipeline node's detail panel is open (event id; one at a time)
  const [openNode, setOpenNode] = useState<string | null>(null)

  // The URL is the single source of truth for filter + selection — changing path
  // segments remounts the page (Next.js), so component state would be wiped.
  //   /chat/diego/<user>            — filter by user
  //   /chat/diego/<user>/<session>  — filter + open that trace
  //   /chat/diego?u=<user>&s=<id>   — open a trace with NO list filter (in-UI click)
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

  const pickSession = useCallback(
    (user: string, id: string) => {
      window.history.replaceState(
        null,
        '',
        userFilter
          ? `/chat/diego/${encodeURIComponent(userFilter)}/${encodeURIComponent(id)}`
          : `/chat/diego?u=${encodeURIComponent(user)}&s=${encodeURIComponent(id)}`
      )
    },
    [userFilter]
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
      window.history.replaceState(null, '', url)
    },
    [selected]
  )

  const loadList = useCallback(async () => {
    // no setState before the first await — `loading` starts true, refresh sets it in the handler
    try {
      const r = await fetch('/api/diego/sessions')
      const j = await r.json()
      if (!j.success) throw new Error(j.error)
      setSessions(j.sessions)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadList()
  }, [loadList])

  // detail-loading is DERIVED (selected ≠ loaded key), so the effect never sets state synchronously
  const selKey = selected ? `${selected.user}/${selected.id}` : null
  const loadingDetail = !!selKey && detail?.key !== selKey

  useEffect(() => {
    if (!selected) return
    let dead = false
    const key = `${selected.user}/${selected.id}`
    fetch(`/api/diego/sessions?user=${encodeURIComponent(selected.user)}&id=${encodeURIComponent(selected.id)}`)
      .then((r) => r.json())
      .then((j) => {
        if (dead) return
        if (j.success) setDetail({ key, events: j.session.events })
        else setError(j.error)
      })
      .catch((e) => {
        if (!dead) setError(String(e))
      })
    return () => {
      dead = true
    }
  }, [selected])

  const selectedSummary = useMemo(
    () => sessions.find((s) => s.userId === selected?.user && s.sessionId === selected?.id),
    [sessions, selected]
  )

  const visibleSessions = useMemo(
    () => (userFilter ? sessions.filter((s) => sameUser(userFilter, s.userId)) : sessions),
    [sessions, userFilter]
  )

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

  return (
    // minmax(0,1fr): a plain 1fr column refuses to shrink below its content
    // (long mono lines / JSON blocks), pushing the page under the fixed sidebar.
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      {/* ---- session list ---- */}
      <Panel
        title={`Sessions (${visibleSessions.length}${userFilter ? ` / ${sessions.length}` : ''})`}
        subtitle="One session per car — id is the VIN, user is the customer code"
        icon={<Car className="h-4 w-4" />}
        action={
          <button
            onClick={() => {
              setLoading(true)
              void loadList()
            }}
            className="rounded-md border border-[var(--color-border-default)] p-1.5 text-gray-400 hover:text-white"
            title="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        }
      >
        {error && <div className="mb-2 rounded bg-red-500/10 p-2 text-xs text-red-400">{error}</div>}
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
        </div>
        <div className="max-h-[75vh] space-y-2 overflow-y-auto pr-1">
          {visibleSessions.map((s) => {
            const active = selected?.user === s.userId && selected?.id === s.sessionId
            const cust = customerCode(s.userId)
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
                  <span className="font-mono text-sm text-white">{s.sessionId}</span>
                  <span className="text-[11px] text-gray-500">{fmtTime(s.updateTime)}</span>
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
              {userFilter ? `No sessions for user ${userFilter}` : 'No sessions yet'}
            </div>
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
        {!loadingDetail && detail && (
          <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
            {/* newest turn first; each turn is a collapsible group — latest open, older
                ones fold to a one-line summary (query · status · duration · time) */}
            {(() => {
              const turns = groupTurns(detail.events).reverse()
              return turns.map((turn, ti) => {
                const s = turnSummary(turn)
                // Latest part-state in the turn (lubinski_stock re-emits enriched with lub_qty
                // after enrich_parts) — the answer renders its part cards from this JSON.
                const enriched = [...turn.nodes].reverse()
                  .map((n) => (n.e.stateDelta as any)?.enriched)
                  .find((x) => Array.isArray(x) && x.length)
                return (
                  <details
                    key={ti}
                    open={ti === 0}
                    className="group rounded-xl border border-[var(--color-border-default)] bg-black/10"
                  >
                    <summary className="flex cursor-pointer select-none flex-wrap items-center gap-2 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-500 transition-transform group-open:rotate-90" />
                      <span className="font-mono text-[11px] text-gray-600">#{turns.length - ti}</span>
                      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[s.status]}`} />
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
                        {turn.user && <span>{fmtTime(turn.user.timestamp)}</span>}
                      </span>
                    </summary>
                    <div className="space-y-2 border-t border-[var(--color-border-default)] p-3">
                      {turn.user && <EventCard e={turn.user} />}
                      {turn.nodes.length > 0 && (
                        <PipelineStrip
                          nodes={turn.nodes}
                          openId={openNode}
                          onToggle={(id) => setOpenNode(openNode === id ? null : id)}
                          turnKey={ti}
                        />
                      )}
                      {turn.answer && <EventCard e={turn.answer} enriched={enriched} />}
                    </div>
                  </details>
                )
              })
            })()}
            {detail.events.length === 0 && (
              <div className="p-6 text-center text-sm text-gray-500">No events in this session</div>
            )}
          </div>
        )}
        {!loadingDetail && !detail && !selected && (
          <div className="p-10 text-center text-sm text-gray-500">← Pick a car session</div>
        )}
      </Panel>
    </div>
  )
}
