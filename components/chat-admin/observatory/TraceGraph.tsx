'use client'

import React, { useMemo } from 'react'
import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge, MarkerType } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
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
    const link = (source: string, target: string, hot = false, prod = false, dashed = false) =>
      edges.push({ id: `${source}->${target}`, source, target, animated: hot,
        style: { stroke: hot ? '#34d399' : prod ? '#818cf8' : '#475569', strokeWidth: hot ? 2.5 : 1, strokeDasharray: dashed ? '4 4' : undefined },
        markerEnd: { type: MarkerType.ArrowClosed } })

    // group: category → subcategory → candidates
    const cats = new Map<string, Map<string, any[]>>()
    for (const c of cands) {
      const cat = c.category || '(none)', sub = c.subcategory || '(none)'
      if (!cats.has(cat)) cats.set(cat, new Map())
      const sm = cats.get(cat)!
      if (!sm.has(sub)) sm.set(sub, [])
      sm.get(sub)!.push(c)
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
          at('candidate', cx, Y.cand, { ...c, vehicle: trace.vehicleData, query: trace.partDescription }, c.id)
          link(subId, c.id, c.isSelected, c.isProduction, c.nearMiss || (!c.isSelected && !c.isProduction))
          if (c.isSelected) selectedCenter = cx
        }
        const subX = avg(candCenters)
        subCenters.push(subX)
        at('subcategory', subX, Y.sub, { name: sub, count: cs.length }, subId)
        link(catId, subId)
        catCount += cs.length
      }
      const catX = avg(subCenters)
      catCenters.push(catX)
      at('category', catX, Y.cat, { name: cat, count: sm.size }, catId)
      link('input', catId)
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

  return (
    <div className="h-[62vh] w-full rounded-lg border border-slate-700 bg-slate-900/40">
      <ReactFlow
        nodes={nodes} edges={edges} nodeTypes={nodeTypes}
        fitView colorMode="dark" minZoom={0.2} proOptions={{ hideAttribution: true }}
        onNodeClick={(_, n) => onSelect(n.id === 'input' || n.id === 'resolved' ? null : n.id)}
        onPaneClick={() => onSelect(null)}
      >
        <Background color="#334155" gap={18} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-slate-800" nodeColor="#475569" />
      </ReactFlow>
    </div>
  )
}
