'use client'

/**
 * Diego v3 simulator — is v3 actually good, and is it at least as good as v2?
 *
 * `sim_run.py` (diego-adk) asks Diego a corpus of REAL customer questions mined from
 * lookup_events + search_analytics, grades each answer with deterministic hard checks plus an
 * LLM judge, and compares the parts answers to v2 live. This page is the result.
 *
 * The failures are the reason to open it, so they sort to the top and the reasoning is one
 * click away — a score with no explanation is not actionable.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, RefreshCw, Swords, Timer } from 'lucide-react'
import { Panel } from '@/components/chat-admin/Panel'
import { AdminPageHeader } from '@/components/chat-admin/shared'
import { fmtDateTime, relTime } from '@/lib/chat-admin/format'

interface Run {
  id: string; startedAt: string; finishedAt: string | null; cases: number; avgScore: number
  hardPass: number; hardTotal: number; v3Better: number; v2Better: number; abEqual: number
}
interface DomainScore { domain: string; n: number; avgScore: number; hardFailures: number }
interface Latency {
  v3Median: number | null; v3P90: number | null; v3Max: number | null; v3N: number
  v2Median: number | null; v2P90: number | null; v2Max: number | null; v2N: number
  v2Dead: number
}
interface Case {
  id: number; caseId: string; domain: string; kind: string; source: string
  question: string; vehicle: string | null; expectCode: string | null; expectMiss: boolean
  baselineScore: number | null
  v3Answer: string | null; v3Seconds: number | null; v3Images: number; v3Silent: boolean
  v2Answer: string | null; v2Seconds: number | null
  checks: Record<string, boolean | null>
  score: number; reasoning: string | null
  verdict: string | null; abReasoning: string | null; cappedBy: string | null
}

// Admin UI is English/LTR by convention (see AdminPageHeader); only the customer
// questions and Diego's answers are Hebrew, and those carry dir="auto".
const DOMAIN_LABEL: Record<string, string> = {
  parts: 'Parts', miss: 'Should find nothing', delivery: 'Deliveries out',
  shipment: 'Shipments in', business: 'Business data', hours: 'Hours & address',
}
const CHECK_LABEL: Record<string, string> = {
  answered: 'answered at all', no_error: 'no error', code_match: 'correct part code',
  image_sent: 'drawing sent', honest_miss: 'admitted not found', grounded: 'backed by a tool',
  no_stalling: 'answered immediately',
}

function scoreTone(s: number): string {
  if (s >= 5) return 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30'
  if (s >= 4) return 'text-lime-600 dark:text-lime-400 bg-lime-50 dark:bg-lime-500/10 border-lime-200 dark:border-lime-500/30'
  if (s >= 3) return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30'
  return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30'
}

export default function SimulatorPage() {
  const [runs, setRuns] = useState<Run[]>([])
  const [latest, setLatest] = useState<Run | null>(null)
  const [byDomain, setByDomain] = useState<DomainScore[]>([])
  const [latency, setLatency] = useState<Latency | null>(null)
  const [failingChecks, setFailingChecks] = useState<Array<{ check: string; n: number }>>([])
  const [cases, setCases] = useState<Case[]>([])
  const [selected, setSelected] = useState<string>('')
  const [open, setOpen] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [notRunYet, setNotRunYet] = useState(false)

  // The run lives in the URL, so a run can be linked to — "look at this one" was previously
  // impossible to say. history.replaceState rather than router.push: this is the same page
  // showing different data, so it should not stack a back-button entry per click.
  const syncUrl = (runId?: string) => {
    if (typeof window === 'undefined') return
    const u = new URL(window.location.href)
    if (runId) u.searchParams.set('run', runId)
    else u.searchParams.delete('run')
    window.history.replaceState(null, '', u.toString())
  }

  const load = useCallback(async (runId?: string) => {
    setLoading(true)
    try {
      const [o, c] = await Promise.all([
        fetch('/api/diego/simulator').then((r) => r.json()),
        fetch(`/api/diego/simulator?cases=1${runId ? `&run=${encodeURIComponent(runId)}` : ''}`)
          .then((r) => r.json()),
      ])
      if (o.success) {
        setRuns(o.runs ?? []); setLatest(o.latest ?? null)
        setByDomain(o.byDomain ?? []); setFailingChecks(o.failingChecks ?? [])
        setLatency(o.latency ?? null)
        setNotRunYet(Boolean(o.notRunYet))
      }
      if (c.success) {
        setCases(c.cases ?? [])
        setSelected(c.run?.id ?? '')
        syncUrl(c.run?.id)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // A deep link (?run=<id>, or the /chat/simulator/run_id=<id> path that redirects here)
  // selects that run instead of the newest one.
  useEffect(() => {
    const fromUrl = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('run') || undefined
      : undefined
    void load(fromUrl)
  }, [load])

  const selectedRun = runs.find((r) => r.id === selected) ?? latest

  // Split the list by DOMAIN. 82 rows of mixed parts/deliveries/business is a wall — and the
  // domains fail for completely different reasons, so they are read one at a time. Domains are
  // ordered worst-average FIRST, for the same reason failures sort to the top within one: the
  // point of the page is what is broken. Order inside a domain is left exactly as the API sent
  // it (failures first), so grouping never hides a failure behind a passing row.
  const groups = (() => {
    const by = new Map<string, Case[]>()
    for (const c of cases) {
      const g = by.get(c.domain); if (g) g.push(c); else by.set(c.domain, [c])
    }
    return [...by.entries()]
      .map(([domain, list]) => ({
        domain,
        list,
        avg: list.reduce((a, c) => a + c.score, 0) / (list.length || 1),
        failures: list.filter((c) => Object.values(c.checks).some((v) => v === false)).length,
      }))
      .sort((a, b) => a.avg - b.avg)
  })()
  // While a run is in progress its cases land one at a time, so follow it. 15s rather than
  // something snappier because a parts case takes 10-60s — polling faster would just re-fetch
  // the same rows. Stops on its own the moment finished_at is stamped.
  const running = Boolean(selectedRun && !selectedRun.finishedAt)
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => { void load(selected || undefined) }, 15000)
    return () => clearInterval(t)
  }, [running, selected, load])

  const hardRate = latest && latest.hardTotal
    ? Math.round((latest.hardPass / latest.hardTotal) * 100) : 0

  return (
    <div className="p-6 space-y-6">
      <AdminPageHeader
        title="Diego Simulator"
        subtitle="Real customer questions replayed against Diego v3 and graded — with a live head-to-head against v2"
        actions={
          <button onClick={() => void load(selected)}
                  className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-accent">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        }
      />

      {notRunYet && (
        <Panel title="Not run yet">
          <p className="text-sm text-muted-foreground">
            No results yet. On the box, run:{' '}
            <code className="rounded bg-muted px-1.5 py-0.5">venv/bin/python sim_run.py --limit 20 --ab</code>
          </p>
        </Panel>
      )}

      {latest && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Panel title="Overall score">
            <div className={`inline-flex rounded-lg border px-3 py-1 text-2xl font-semibold ${scoreTone(latest.avgScore)}`}>
              {latest.avgScore.toFixed(2)}<span className="text-base opacity-60">/5</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{latest.cases} questions · {relTime(latest.startedAt)}</p>
          </Panel>
          <Panel title="Hard checks">
            <div className="text-2xl font-semibold">{hardRate}%</div>
            <p className="mt-1 text-xs text-muted-foreground">{latest.hardPass}/{latest.hardTotal} passed</p>
          </Panel>
          <Panel title="vs Diego v2">
            <div className="flex items-center gap-2 text-sm">
              <Swords className="h-4 w-4 text-muted-foreground" />
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{latest.v3Better}</span> better ·
              <span className="font-semibold text-muted-foreground">{latest.abEqual}</span> equal ·
              <span className="font-semibold text-red-600 dark:text-red-400">{latest.v2Better}</span> worse
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Parts questions only — v2 cannot answer the rest</p>
          </Panel>
          <Panel title="Most common failures">
            {failingChecks.length === 0
              ? <p className="text-sm text-muted-foreground">None</p>
              : <ul className="space-y-0.5 text-sm">
                  {failingChecks.slice(0, 4).map((f) => (
                    <li key={f.check} className="flex justify-between gap-2">
                      <span>{CHECK_LABEL[f.check] ?? f.check}</span>
                      <span className="font-semibold text-red-600 dark:text-red-400">{f.n}</span>
                    </li>
                  ))}
                </ul>}
          </Panel>
        </div>
      )}

      {byDomain.length > 0 && (
        <Panel title="Score by domain">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {byDomain.map((d) => (
              <div key={d.domain} className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{DOMAIN_LABEL[d.domain] ?? d.domain}</div>
                <div className={`mt-1 inline-flex rounded border px-2 py-0.5 text-lg font-semibold ${scoreTone(d.avgScore)}`}>
                  {d.avgScore.toFixed(2)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {d.n} questions{d.hardFailures > 0 && <span className="text-red-600"> · {d.hardFailures} failed</span>}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {latency && latency.v3N > 0 && (
        <Panel title="Response time">
          <div className="grid gap-3 md:grid-cols-2">
            {([
              ['v3', latency.v3Median, latency.v3P90, latency.v3Max, latency.v3N],
              ['v2', latency.v2Median, latency.v2P90, latency.v2Max, latency.v2N],
            ] as const).filter(([, med]) => med !== null).map(([label, med, p90, max, n]) => (
              <div key={label} className="rounded-lg border p-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Timer className="h-3.5 w-3.5" />{label} · {n} answers
                </div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="text-2xl font-semibold">{med!.toFixed(1)}s</span>
                  <span className="text-xs text-muted-foreground">median</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  p90 {p90!.toFixed(1)}s · slowest {max!.toFixed(1)}s
                </div>
              </div>
            ))}
          </div>
          {/* Both numbers are real wall clock, but they are not a controlled experiment:
              v3 is asked first and both versions walk the same catalogs behind one dealer
              login, so v2 can be answering into state v3 just warmed. */}
          <p className="mt-2 text-xs text-muted-foreground">
            Median of the wait a customer would see. v3 is asked first and both versions share
            one catalog login, so read the medians, not a single question.
            {latency.v2Dead > 0 && ` ${latency.v2Dead} v2 call(s) never answered and are excluded — a timeout is a missing measurement, not a slow one.`}
          </p>
        </Panel>
      )}

      {runs.length > 1 && (
        <Panel title="Runs">
          <div className="flex flex-wrap gap-2">
            {runs.map((r) => (
              <button key={r.id} onClick={() => void load(r.id)}
                      className={`rounded-lg border px-3 py-1.5 text-xs ${
                        r.id === selected ? 'border-blue-400 bg-blue-50 dark:bg-blue-500/10 font-semibold' : 'hover:bg-accent'}`}>
                {!r.finishedAt && (
                  <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500"
                        title="running now" />
                )}
                {fmtDateTime(r.startedAt)} · {r.avgScore.toFixed(2)}/5 · {r.cases}
              </button>
            ))}
          </div>
        </Panel>
      )}

      <Panel title={`Questions (${cases.length}) — by domain, worst first${
        selectedRun && !selectedRun.finishedAt ? ' · running, updating every 15s' : ''}`}>
        <div className="space-y-2">
          {groups.map((g) => (
            <section key={g.domain} className="space-y-2">
              <header className="flex items-center gap-2 pt-2 text-xs">
                <span className="font-semibold">{DOMAIN_LABEL[g.domain] ?? g.domain}</span>
                <span className="text-muted-foreground">{g.list.length} question{g.list.length === 1 ? '' : 's'}</span>
                <span className={`rounded border px-1.5 py-0.5 font-semibold ${scoreTone(Math.round(g.avg))}`}>
                  {g.avg.toFixed(2)}
                </span>
                {g.failures > 0 && (
                  <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                    <AlertTriangle className="h-3 w-3" />{g.failures} failing
                  </span>
                )}
                <span className="h-px flex-1 bg-border" />
              </header>
          {g.list.map((c) => {
            const failed = Object.entries(c.checks).filter(([, v]) => v === false).map(([k]) => k)
            const isOpen = open === c.id
            return (
              <div key={c.id} className={`rounded-lg border ${failed.length ? 'border-red-300 dark:border-red-500/40 bg-red-50/40 dark:bg-red-500/5' : ''}`}>
                <button onClick={() => setOpen(isOpen ? null : c.id)}
                        className="flex w-full items-start gap-3 p-3 text-right">
                  <span className={`mt-0.5 inline-flex shrink-0 rounded border px-2 py-0.5 text-sm font-semibold ${scoreTone(c.score)}`}>
                    {c.score}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {c.question}
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {DOMAIN_LABEL[c.domain] ?? c.domain}
                      </span>
                      {c.kind !== 'text' && (
                        <span className="rounded bg-purple-100 dark:bg-purple-500/15 px-1.5 py-0.5 text-xs text-purple-700 dark:text-purple-300">{c.kind}</span>
                      )}
                      {c.verdict && (
                        <span className={`rounded px-1.5 py-0.5 text-xs ${
                          c.verdict === 'v3_better' ? 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : c.verdict === 'v2_better' ? 'bg-red-100 dark:bg-red-500/15 text-red-700 dark:text-red-300'
                          : 'bg-gray-100 text-muted-foreground'}`}>
                          {c.verdict === 'v3_better' ? 'v3 better' : c.verdict === 'v2_better' ? 'v2 better' : 'equal'}
                        </span>
                      )}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {failed.length > 0
                        ? <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                            <AlertTriangle className="h-3 w-3" />
                            {failed.map((f) => CHECK_LABEL[f] ?? f).join(' · ')}
                          </span>
                        : <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />all checks passed
                          </span>}
                      {c.v3Seconds !== null && <span>{c.v3Seconds.toFixed(1)}s</span>}
                      {c.expectCode && <span>expected: {c.expectCode}</span>}
                      {c.baselineScore !== null && <span>baseline: {c.baselineScore}/100</span>}
                      <span className="opacity-60">{c.source}</span>
                    </span>
                  </span>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen && (
                  <div className="space-y-3 border-t p-3 text-sm">
                    {c.reasoning && (
                      <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 p-3">
                        <div className="mb-1 text-xs font-semibold text-amber-700 dark:text-amber-300">Judge's reasoning</div>
                        <p className="text-foreground" dir="auto">{c.reasoning}</p>
                        {c.cappedBy && (
                          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                            Score capped by: {CHECK_LABEL[c.cappedBy] ?? c.cappedBy}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="mb-1 text-xs font-semibold text-muted-foreground">
                          v3 {c.v3Images > 0 && `· ${c.v3Images} drawings`}
                        </div>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs" dir="auto">
                          {c.v3Silent ? '(silent — no reply at all)' : c.v3Answer}
                        </pre>
                      </div>
                      <div>
                        <div className="mb-1 text-xs font-semibold text-muted-foreground">
                          {/* Runs before 2026-08-17 stored the 180s timeout in v2Seconds, so
                              the time is shown only when v2 actually replied. */}
                          v2 {c.v2Answer?.startsWith('__v2_error__')
                                ? '· never answered'
                                : c.v2Seconds !== null && `· ${c.v2Seconds.toFixed(1)}s`}
                        </div>
                        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs" dir="auto">
                          {c.v2Answer ?? '(not asked)'}
                        </pre>
                      </div>
                    </div>
                    {c.abReasoning && (
                      <p className="text-xs text-muted-foreground" dir="auto">Head-to-head: {c.abReasoning}</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
            </section>
          ))}
          {cases.length === 0 && !loading && (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing to show</p>
          )}
        </div>
      </Panel>
    </div>
  )
}
