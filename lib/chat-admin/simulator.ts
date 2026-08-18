/**
 * Diego v3 simulator results — read-only views over `sim_runs` / `sim_cases`.
 *
 * Those tables are written by `sim_run.py` in the diego-adk repo, which asks Diego a corpus of
 * REAL customer questions (mined from lookup_events + search_analytics), grades each answer
 * with hard checks plus an LLM judge, and optionally compares it to Diego v2 live.
 *
 * The point of the page this feeds is one question: is v3 at least as good as v2, and is it
 * right about deliveries, shipments, business data and opening hours — not just parts.
 */

import { query } from '@/lib/db'

export interface SimRun {
  id: string
  startedAt: string
  finishedAt: string | null
  cases: number
  avgScore: number
  hardPass: number
  hardTotal: number
  v3Better: number
  v2Better: number
  abEqual: number
}

export interface SimCase {
  id: number
  caseId: string
  domain: string
  kind: string
  source: string
  question: string
  vehicle: string | null
  expectCode: string | null
  expectMiss: boolean
  baselineScore: number | null
  v3Answer: string | null
  v3Seconds: number | null
  v3Images: number
  v3Silent: boolean
  v3Error: string | null
  v2Answer: string | null
  v2Seconds: number | null
  checks: Record<string, boolean | null>
  score: number
  reasoning: string | null
  verdict: string | null
  abReasoning: string | null
  cappedBy: string | null
}

export interface DomainScore {
  domain: string
  n: number
  avgScore: number
  hardFailures: number
}

/** How long each version made the customer wait, over one run. */
export interface SimLatency {
  v3Median: number | null; v3P90: number | null; v3Max: number | null; v3N: number
  v2Median: number | null; v2P90: number | null; v2Max: number | null; v2N: number
  v2Dead: number                 // v2 calls that never answered — timed out, not slow
}

export interface SimOverview {
  runs: SimRun[]
  latest: SimRun | null
  byDomain: DomainScore[]
  latency: SimLatency | null
  trend: Array<{ runId: string; startedAt: string; domain: string; avgScore: number }>
  failingChecks: Array<{ check: string; n: number }>
}

const n = (v: unknown) => Number(v ?? 0)

function toRun(r: Record<string, unknown>): SimRun {
  return {
    id: String(r.id),
    startedAt: String(r.started_at),
    finishedAt: r.finished_at ? String(r.finished_at) : null,
    cases: n(r.cases),
    avgScore: Number(r.avg_score ?? 0),
    hardPass: n(r.hard_pass),
    hardTotal: n(r.hard_total),
    v3Better: n(r.v3_better),
    v2Better: n(r.v2_better),
    abEqual: n(r.ab_equal),
  }
}

/** Recent runs, per-domain scores for the latest, the trend, and which checks fail most. */
export async function getSimOverview(limit = 20): Promise<SimOverview> {
  const runsRes = await query(
    `SELECT * FROM sim_runs ORDER BY started_at DESC LIMIT $1`, [limit])
  const runs = (runsRes.rows as Record<string, unknown>[]).map(toRun)
  // `runs` is newest-first, so runs[0] is the live one while a run is in progress — which is
  // what someone watching wants the tiles to describe. sim_run.py opens the row before the
  // first case and stamps finished_at at the end, so `finishedAt === null` IS "still running".
  const latest = runs[0] ?? null

  let byDomain: DomainScore[] = []
  if (latest) {
    const d = await query(
      `SELECT domain, COUNT(*) n, AVG(score)::float avg_score,
              COUNT(*) FILTER (WHERE capped_by <> '') hard_failures
         FROM sim_cases WHERE run_id = $1
        GROUP BY domain ORDER BY domain`, [latest.id])
    byDomain = (d.rows as Record<string, unknown>[]).map((r) => ({
      domain: String(r.domain),
      n: n(r.n),
      avgScore: Number(r.avg_score ?? 0),
      hardFailures: n(r.hard_failures),
    }))
  }

  // Response time for the latest run. Medians and p90, never means: one 200s catalog walk
  // moves a mean by seconds across a whole run and tells you nothing about a typical wait.
  //
  // A v2 call that never came back is EXCLUDED, not counted as a slow answer. Runs before
  // 2026-08-17 stored the 180s timeout in `v2_seconds` as if it were a response time, which
  // pulled v2's mean from 30s up to 40s — close enough to v3's to hide that v2 was in fact
  // finishing in half v3's median. Newer runs write NULL; the `__v2_error__` guard covers
  // the rows already on disk.
  let latency: SimLatency | null = null
  if (latest) {
    const lat = await query(
      `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY v3_seconds)
                FILTER (WHERE v3_seconds > 0)                                  AS v3_med,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY v3_seconds)
                FILTER (WHERE v3_seconds > 0)                                  AS v3_p90,
              MAX(v3_seconds) FILTER (WHERE v3_seconds > 0)                    AS v3_max,
              COUNT(*)        FILTER (WHERE v3_seconds > 0)                    AS v3_n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY v2_seconds)
                FILTER (WHERE v2_seconds > 0 AND left(v2_answer, 12) <> '__v2_error__') AS v2_med,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY v2_seconds)
                FILTER (WHERE v2_seconds > 0 AND left(v2_answer, 12) <> '__v2_error__') AS v2_p90,
              MAX(v2_seconds) FILTER (WHERE v2_seconds > 0
                                        AND left(v2_answer, 12) <> '__v2_error__')      AS v2_max,
              COUNT(*)        FILTER (WHERE v2_seconds > 0
                                        AND left(v2_answer, 12) <> '__v2_error__')      AS v2_n,
              COUNT(*)        FILTER (WHERE left(v2_answer, 12) = '__v2_error__')       AS v2_dead
         FROM sim_cases WHERE run_id = $1`, [latest.id])
    const r = (lat.rows as Record<string, unknown>[])[0] ?? {}
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    latency = {
      v3Median: num(r.v3_med), v3P90: num(r.v3_p90), v3Max: num(r.v3_max), v3N: n(r.v3_n),
      v2Median: num(r.v2_med), v2P90: num(r.v2_p90), v2Max: num(r.v2_max), v2N: n(r.v2_n),
      v2Dead: n(r.v2_dead),
    }
  }

  // Trend across runs, per domain — a regression shows up as one domain sagging while the
  // overall average still looks fine, which is exactly the case a single number hides.
  const t = await query(
    `SELECT c.run_id, r.started_at, c.domain, AVG(c.score)::float avg_score
       FROM sim_cases c JOIN sim_runs r ON r.id = c.run_id
      WHERE r.started_at > now() - interval '30 days'
      GROUP BY c.run_id, r.started_at, c.domain
      ORDER BY r.started_at`)
  const trend = (t.rows as Record<string, unknown>[]).map((r) => ({
    runId: String(r.run_id),
    startedAt: String(r.started_at),
    domain: String(r.domain),
    avgScore: Number(r.avg_score ?? 0),
  }))

  // Which hard check fails most often across the last 30 days. `checks` is jsonb of
  // name -> bool; jsonb_each_text lets us count the false ones without a schema change.
  const f = await query(
    `SELECT kv.key AS check, COUNT(*) n
       FROM sim_cases c
       JOIN sim_runs r ON r.id = c.run_id,
            LATERAL jsonb_each_text(c.checks) kv
      WHERE r.started_at > now() - interval '30 days' AND kv.value = 'false'
      GROUP BY kv.key ORDER BY n DESC`)
  const failingChecks = (f.rows as Record<string, unknown>[]).map((r) => ({
    check: String(r.check), n: n(r.n),
  }))

  return { runs, latest, byDomain, latency, trend, failingChecks }
}

/** Every case of one run — newest run when no id is given. Worst first: the failures are
 *  the reason anyone opens this page. */
export async function getSimCases(runId?: string): Promise<{ run: SimRun | null; cases: SimCase[] }> {
  const runRes = await query(
    runId ? `SELECT * FROM sim_runs WHERE id = $1`
          : `SELECT * FROM sim_runs ORDER BY started_at DESC LIMIT 1`,
    runId ? [runId] : undefined)
  const runRow = (runRes.rows as Record<string, unknown>[])[0]
  if (!runRow) return { run: null, cases: [] }
  const run = toRun(runRow)

  const res = await query(
    `SELECT * FROM sim_cases WHERE run_id = $1
      ORDER BY (capped_by <> '') DESC, score ASC, domain, case_id`, [run.id])
  const cases = (res.rows as Record<string, unknown>[]).map((r) => ({
    id: n(r.id),
    caseId: String(r.case_id ?? ''),
    domain: String(r.domain ?? ''),
    kind: String(r.kind ?? 'text'),
    source: String(r.source ?? ''),
    question: String(r.question ?? ''),
    vehicle: r.vehicle ? String(r.vehicle) : null,
    expectCode: r.expect_code ? String(r.expect_code) : null,
    expectMiss: Boolean(r.expect_miss),
    baselineScore: r.baseline_score === null ? null : n(r.baseline_score),
    v3Answer: r.v3_answer ? String(r.v3_answer) : null,
    v3Seconds: r.v3_seconds === null ? null : Number(r.v3_seconds),
    v3Images: n(r.v3_images),
    v3Silent: Boolean(r.v3_silent),
    v3Error: r.v3_error ? String(r.v3_error) : null,
    v2Answer: r.v2_answer ? String(r.v2_answer) : null,
    v2Seconds: r.v2_seconds === null ? null : Number(r.v2_seconds),
    checks: (r.checks ?? {}) as Record<string, boolean | null>,
    score: n(r.score),
    reasoning: r.reasoning ? String(r.reasoning) : null,
    verdict: r.verdict ? String(r.verdict) : null,
    abReasoning: r.ab_reasoning ? String(r.ab_reasoning) : null,
    cappedBy: r.capped_by ? String(r.capped_by) : null,
  }))
  return { run, cases }
}
