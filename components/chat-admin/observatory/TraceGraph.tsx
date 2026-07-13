'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { ReactFlow, Background, Controls, MiniMap, Panel, type Node, type Edge, MarkerType } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Maximize2, X } from 'lucide-react'
import { nodeTypes } from './RuleNode'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Deterministic layered layout (input → candidates lane → resolved). No async layout engine
 *  needed for this DAG shape, so the canvas is robust and never blank. */
export function TraceGraph({ trace, onSelect }: { trace: any; onSelect: (id: string | null) => void }) {
  const { nodes, edges } = useMemo(() => {
    // Grouped top-down TREE: input → category → subcategory → candidate rules → resolved.
    const cands: any[] = trace?.candidates || []
    const CW = 320                                   // horizontal slot per candidate
    const Y = { input: 0, cat: 180, sub: 330, cand: 500, resolved: 800 }
    const HALF: Record<string, number> = { input: 128, category: 70, subcategory: 90, candidate: 144, resolved: 128 }
    const nodes: Node[] = []
    const edges: Edge[] = []
    const at = (kind: string, centerX: number, y: number, data: any, id: string) =>
      nodes.push({ id, type: 'rule', position: { x: centerX - HALF[kind], y }, data: { ...data, kind } })
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
    // A candidate is "related" (answers the SAME part term as the query) vs a semantic neighbor
    // (a different part that merely embeds close by). Same logic the node uses for its "שכן סמנטי" tag.
    const isNeighbor = (q?: string, d?: string) => {
      if (!q || !d) return false
      const a = q.toLowerCase().trim(), b = d.toLowerCase().trim()
      return !a.includes(b) && !b.includes(a)
    }
    // Edge tiers: winner=green (animated) · another rule for the same part=orange · prod-disagrees=indigo · neighbor=slate.
    // opacity encodes match STRENGTH — how many of the rule's vehicle conditions the target car satisfies (brighter = more).
    const link = (source: string, target: string, hot = false, prod = false, dashed = false, related = false, opacity = 1) =>
      edges.push({ id: `${source}->${target}`, source, target, animated: hot,
        style: {
          stroke: hot ? '#34d399' : prod ? '#818cf8' : related ? '#fb923c' : '#475569',
          strokeWidth: hot ? 2.5 : (prod || related) ? 1.75 : 1,
          strokeDasharray: dashed ? '4 4' : undefined,
          opacity,
        },
        markerEnd: { type: MarkerType.ArrowClosed } })

    // Brightness driver: ABSOLUTE count of the rule's vehicle conditions the target car satisfies
    // (`matched`), on a fixed 0..MAX scale — NOT relative to the best match in view. So a 4/4 is
    // bright but a hypothetical 5/5 (same 100%, one more true condition) is brighter, and a rule's
    // brightness doesn't change just because the query returned a stronger/weaker set. Generic rules
    // (0 conditions → 0 true) land at the dim floor; the winner stays fully bright for visibility.
    const MAX_CONDITIONS = 5   // year · model · fuel · engine · VIN
    const normOf = (c: any) => (c.isSelected ? 1 : Math.min(1, (c.matched || 0) / MAX_CONDITIONS))

    // group: category → subcategory → candidates
    const cats = new Map<string, Map<string, any[]>>()
    for (const c of cands) {
      const cat = c.category || '(none)', sub = c.subcategory || '(none)'
      if (!cats.has(cat)) cats.set(cat, new Map())
      const sm = cats.get(cat)!
      if (!sm.has(sub)) sm.set(sub, [])
      sm.get(sub)!.push(c)
    }

    // Terms the query resolved to (raw + English canonical + synonyms) — used to decide, per
    // candidate, whether it answers the SAME part (language-robust: a Hebrew query still matches
    // its English canonical term against the candidate's English part_description).
    const queryTerms: string[] = [
      ...((trace?.expansion || []) as any[]).map((e) => e.term),
      trace?.partDescription,
    ].filter(Boolean)
    const isRelated = (desc?: string, winningTerm?: string) => {
      const terms = [winningTerm, ...queryTerms].filter(Boolean) as string[]
      return !!desc && terms.some((t) => !isNeighbor(t, desc))
    }

    let slot = 0
    let selectedCenter: number | null = null
    const selected = cands.find((c) => c.isSelected)
    const catCenters: number[] = []
    for (const [cat, sm] of cats) {
      const catId = `cat:${cat}`
      const subCenters: number[] = []
      let catCount = 0
      for (const [sub, cs] of sm) {
        const subId = `sub:${cat}:${sub}`
        const candCenters: number[] = []
        for (const c of cs) {
          const cx = slot * CW; slot++
          candCenters.push(cx)
          const related = isRelated(c.partDescription, c.winningTerm)   // same part term → orange
          const norm = normOf(c)                                        // 0..1 vehicle-match strength → brightness
          at('candidate', cx, Y.cand, { ...c, vehicle: trace.vehicleData, query: trace.partDescription, related, intensity: norm }, c.id)
          // solid orange for "another rule for this part", dashed slate for semantic neighbors; brighter = more conditions match
          link(subId, c.id, c.isSelected, c.isProduction, !c.isSelected && !c.isProduction && !related, related, 0.3 + 0.7 * norm)
          if (c.isSelected) selectedCenter = cx
        }
        const subX = avg(candCenters)
        subCenters.push(subX)
        at('subcategory', subX, Y.sub, { name: sub, count: cs.length }, subId)
        link(catId, subId, !!selected && cat === selected.category && sub === selected.subcategory)  // highlight winning path
        catCount += cs.length
      }
      const catX = avg(subCenters)
      catCenters.push(catX)
      at('category', catX, Y.cat, { name: cat, count: sm.size }, catId)
      link('input', catId, !!selected && cat === selected.category)                                   // highlight winning path
    }

    const inputX = catCenters.length ? avg(catCenters) : 0
    at('input', inputX, Y.input, { query: trace.partDescription, expansion: trace.expansion, vehicle: trace.vehicleData }, 'input')

    if (selected) {
      at('resolved', selectedCenter ?? inputX, Y.resolved,
        { category: selected.category, subcategory: selected.subcategory, schema: selected.schema, directPart: selected.directPart }, 'resolved')
      link(selected.id, 'resolved', true)
    }
    return { nodes, edges }
  }, [trace])

  const [full, setFull] = useState(false)
  // close fullscreen on Escape
  useEffect(() => {
    if (!full) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [full])

  const canvas = (
    <ReactFlow
      nodes={nodes} edges={edges} nodeTypes={nodeTypes}
      fitView colorMode="dark" minZoom={0.15} proOptions={{ hideAttribution: true }}
      onNodeClick={(_, n) => onSelect(n.id === 'input' || n.id === 'resolved' ? null : n.id)}
      onPaneClick={() => onSelect(null)}
    >
      <Background color="#334155" gap={18} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable className="!bg-slate-800" nodeColor="#475569" />
      <Panel position="bottom-left">
        <div className="rounded-md border border-slate-700 bg-slate-900/85 px-2.5 py-1.5 text-[11px] text-slate-300 backdrop-blur">
          <div className="mb-1 font-semibold text-slate-200">מקרא</div>
          <LegendRow color="#34d399" label="נבחר (התוצאה)" />
          <LegendRow color="#fb923c" label="חוק נוסף לאותו חלק (סכמה אחרת)" />
          <LegendRow color="#818cf8" label="בחירת פרודקשן (שונה)" />
          <LegendRow color="#475569" label="שכן סמנטי / לא קשור" dashed />
          <div className="mt-1 border-t border-slate-700 pt-1 text-[10px] text-slate-400">בהיר יותר = יותר תנאי רכב מתקיימים</div>
        </div>
      </Panel>
      <Panel position="top-right">
        {full ? (
          <button onClick={() => setFull(false)} className="inline-flex items-center gap-1 rounded-md bg-slate-800/90 px-2.5 py-1.5 text-[12px] text-slate-100 hover:bg-slate-700 border border-slate-600">
            <X size={13} /> סגור (Esc)
          </button>
        ) : (
          <button onClick={() => setFull(true)} className="inline-flex items-center gap-1 rounded-md bg-slate-800/90 px-2.5 py-1.5 text-[12px] text-slate-100 hover:bg-slate-700 border border-slate-600">
            <Maximize2 size={13} /> מסך מלא
          </button>
        )}
      </Panel>
    </ReactFlow>
  )

  if (full) {
    return <div className="fixed inset-0 z-[100] bg-slate-950">{canvas}</div>
  }
  return <div className="h-[62vh] w-full rounded-lg border border-slate-700 bg-slate-900/40">{canvas}</div>
}

function LegendRow({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 leading-5">
      <svg width="18" height="6" className="shrink-0">
        <line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth="2.5" strokeDasharray={dashed ? '3 3' : undefined} />
      </svg>
      <span>{label}</span>
    </div>
  )
}
