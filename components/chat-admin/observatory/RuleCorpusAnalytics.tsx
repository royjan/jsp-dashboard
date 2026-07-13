'use client'

import React, { useEffect, useState } from 'react'
import { Loader2, Package, AlertTriangle, Database, Sparkles, Check } from 'lucide-react'
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'

/* eslint-disable @typescript-eslint/no-explicit-any */

const PALETTE = ['#38bdf8', '#34d399', '#f59e0b', '#a78bfa', '#f472b6', '#60a5fa', '#fb7185', '#facc15', '#4ade80', '#22d3ee', '#c084fc', '#94a3b8']
const STATUS_COLORS: Record<string, string> = { approved: '#34d399', suggestion: '#f59e0b', rejected: '#64748b' }
const axis = { stroke: '#475569', fontSize: 11 }
const tip = { contentStyle: { background: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 12, color: '#e2e8f0' } }

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
      <div className="mb-2 text-[12px] font-medium text-slate-300">{title}</div>
      {children}
    </div>
  )
}

function KpiTile({ icon, label, value, sub, action }: { icon: React.ReactNode; label: string; value: any; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">{icon}{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-100">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
      {action}
    </div>
  )
}

export default function RuleCorpusAnalytics() {
  const [s, setS] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filling, setFilling] = useState(false)
  const [fillMsg, setFillMsg] = useState<string | null>(null)

  const loadStats = () => fetch('/api/flow-decisions/stats').then((r) => r.json())
    .then((d) => { if (d.error) setError(d.error); else setS(d) })

  useEffect(() => {
    loadStats().catch((e) => setError(String(e))).finally(() => setLoading(false))
  }, [])

  const fillEmbeddings = async () => {
    setFilling(true); setFillMsg(null)
    try {
      const d = await fetch('/api/flow-decisions/backfill-embeddings', { method: 'POST' }).then((r) => r.json())
      if (d.error) setFillMsg(`שגיאה: ${d.error}`)
      else if (d.noKey) setFillMsg('לא ניתן להטמיע — מפתח OpenAI חסר (או שכל הקריאות נכשלו).')
      else setFillMsg(`הוטמעו ${d.filled}${d.failed ? ` · נכשלו ${d.failed}` : ''}${d.remaining ? ` · נותרו ${d.remaining}` : ' · הכל מכוסה ✓'}`)
      await loadStats()
    } catch (e) {
      setFillMsg('שגיאה בהטמעה')
    } finally { setFilling(false) }
  }

  if (loading) return <div className="flex h-40 items-center justify-center text-slate-400"><Loader2 className="animate-spin" size={18} /></div>
  if (error) return <div className="rounded-md border border-rose-500/40 bg-rose-950/30 p-3 text-sm text-rose-200">שגיאה: {error}</div>
  if (!s) return null

  const status = (s.status || []).map((r: any) => ({ name: r.status, value: r.c }))
  const scope = (s.scope || []).map((r: any) => ({ name: r.name === 'generic' ? 'גנרי' : 'ממוקד', value: r.c }))
  const confidence = (s.confidence || []).map((r: any) => ({ bucket: Number(r.bucket).toFixed(1), c: r.c }))
  const embHave = s.embeddings?.have ?? 0, embMiss = s.embeddings?.missing ?? 0
  const embPct = embHave + embMiss ? Math.round((embHave / (embHave + embMiss)) * 100) : 0

  return (
    <div className="space-y-3">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile icon={<Database size={12} />} label="חוקים פעילים" value={s.totals?.rules ?? 0} sub={`${s.totals?.parts ?? 0} תיאורי חלק`} />
        <KpiTile icon={<Package size={12} />} label="חלקים מקושרים" value={s.pins?.total ?? 0} sub={`${s.pins?.oos ?? 0} אזלו מהמלאי`} />
        <KpiTile
          icon={<AlertTriangle size={12} />} label="כיסוי embeddings" value={`${embPct}%`} sub={`${embMiss} חסרים`}
          action={embMiss > 0 ? (
            <button
              onClick={fillEmbeddings} disabled={filling}
              className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-sky-600/90 px-2 py-1 text-[11px] font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {filling ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} מלא חסרים
            </button>
          ) : (
            <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-400"><Check size={11} /> הכל מוטמע</div>
          )}
        />
        <KpiTile icon={<Database size={12} />} label="מקורות" value={(s.source || []).length} sub={(s.source || []).slice(0, 2).map((x: any) => x.src).join(', ')} />
      </div>
      {fillMsg && <div className="rounded-md border border-slate-700 bg-slate-800/40 px-3 py-1.5 text-[12px] text-slate-300">{fillMsg}</div>}

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="התפלגות סטטוס">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={status} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} label>
                {status.map((e: any, i: number) => <Cell key={i} fill={STATUS_COLORS[e.name] || PALETTE[i]} />)}
              </Pie>
              <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="ממוקד מול גנרי">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={scope} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} label>
                {scope.map((_: any, i: number) => <Cell key={i} fill={PALETTE[i]} />)}
              </Pie>
              <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="חוקים לפי קטגוריה">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={s.byCategory} layout="vertical" margin={{ left: 8, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
              <XAxis type="number" {...axis} /><YAxis type="category" dataKey="name" width={130} {...axis} tick={{ fontSize: 10, fill: '#cbd5e1' }} />
              <Tooltip {...tip} /><Bar dataKey="c" fill="#38bdf8" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="חוקים לפי פורטל (lambda)">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={s.byLambda} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" {...axis} /><YAxis {...axis} />
              <Tooltip {...tip} /><Bar dataKey="c" radius={[3, 3, 0, 0]}>
                {(s.byLambda || []).map((_: any, i: number) => <Cell key={i} fill={PALETTE[i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="מקור החוק">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={(s.source || []).map((r: any) => ({ name: r.src, c: r.c }))} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" {...axis} tick={{ fontSize: 9, fill: '#cbd5e1' }} /><YAxis {...axis} />
              <Tooltip {...tip} /><Bar dataKey="c" fill="#a78bfa" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="התפלגות confidence">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={confidence} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="bucket" {...axis} /><YAxis {...axis} />
              <Tooltip {...tip} /><Bar dataKey="c" fill="#34d399" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  )
}
