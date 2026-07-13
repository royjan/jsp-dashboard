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
    // Top-down TREE: input on top → candidates fan out below → resolved at the bottom.
    const cands: any[] = trace?.candidates || []
    const CW = 320                                   // horizontal spacing between candidates
    const ROW_Y = { input: 0, cand: 230, resolved: 470 }
    const nodes: Node[] = []
    const edges: Edge[] = []

    const n = Math.max(cands.length, 1)
    const centerX = ((n - 1) * CW) / 2
    nodes.push({
      id: 'input', type: 'rule', position: { x: centerX - 12, y: ROW_Y.input },
      data: { kind: 'input', query: trace.partDescription, expansion: trace.expansion, vehicle: trace.vehicleData },
    })

    const selected = cands.find((c) => c.isSelected)
    cands.forEach((c, i) => {
      nodes.push({ id: c.id, type: 'rule', position: { x: i * CW, y: ROW_Y.cand }, data: { ...c, kind: 'candidate', vehicle: trace.vehicleData, query: trace.partDescription } })
      edges.push({
        id: `in-${c.id}`, source: 'input', target: c.id,
        animated: c.isSelected,
        style: { stroke: c.isSelected ? '#34d399' : c.isProduction ? '#818cf8' : '#475569', strokeWidth: c.isSelected ? 2.5 : 1, strokeDasharray: c.nearMiss || (!c.isSelected && !c.isProduction) ? '4 4' : undefined },
        markerEnd: { type: MarkerType.ArrowClosed },
      })
    })

    if (selected) {
      nodes.push({
        id: 'resolved', type: 'rule', position: { x: centerX - 12, y: ROW_Y.resolved },
        data: { kind: 'resolved', category: selected.category, subcategory: selected.subcategory, schema: selected.schema, directPart: selected.directPart },
      })
      edges.push({ id: `sel-res`, source: selected.id, target: 'resolved', animated: true, style: { stroke: '#34d399', strokeWidth: 2.5 }, markerEnd: { type: MarkerType.ArrowClosed } })
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
