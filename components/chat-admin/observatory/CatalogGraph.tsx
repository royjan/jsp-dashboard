'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import nextDynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'

/* eslint-disable @typescript-eslint/no-explicit-any */

// react-d3-tree touches window — load client-only.
const Tree = nextDynamic(() => import('react-d3-tree'), { ssr: false }) as any

function renderNode({ nodeDatum, toggleNode }: any) {
  const a = nodeDatum.attributes || {}
  const isSchema = a.kind === 'schema'
  const fill = a.kind === 'category' ? '#38bdf8' : a.kind === 'subcategory' ? '#818cf8' : a.generic ? '#f59e0b' : '#34d399'
  return (
    // stroke="none": react-d3-tree leaks an inherited black stroke onto <text>, which with
    // paint-order:normal paints over the light fill and renders labels near-black/unreadable.
    // Reset it here (the circle re-declares its own stroke below).
    <g stroke="none" style={{ cursor: 'pointer' }} onClick={toggleNode}>
      <circle r={7} fill={fill} stroke="#0f172a" strokeWidth={1.5} />
      <text fill="#e2e8f0" stroke="none" x={12} dy={-2} fontSize={12} style={{ fontWeight: isSchema ? 400 : 600 }}>{nodeDatum.name}</text>
      {a.rules != null && (
        <text fill="#94a3b8" stroke="none" x={12} dy={13} fontSize={10}>
          {a.rules} rules{a.pinned ? ` · ${a.pinned}📌` : ''}{a.lambda && isSchema ? ` · ${a.lambda}` : ''}
        </text>
      )}
    </g>
  )
}

export default function CatalogGraph() {
  const [tree, setTree] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [translate, setTranslate] = useState({ x: 140, y: 200 })

  useEffect(() => {
    fetch('/api/flow-decisions/catalog-tree')
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setTree(d.tree) })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (boxRef.current) {
      const { height } = boxRef.current.getBoundingClientRect()
      setTranslate({ x: 160, y: Math.max(height / 2, 100) })
    }
  }, [tree])

  const count = useMemo(() => tree?.attributes?.rules ?? 0, [tree])

  return (
    <div className="space-y-2">
      <div className="text-[12px] text-slate-400">
        {count ? `${count} חוקים · ${tree?.children?.length || 0} קטגוריות — לחץ צומת כדי לפתוח/לסגור` : ''}
      </div>
      <div ref={boxRef} className="h-[64vh] w-full rounded-lg border border-slate-700 bg-slate-900/40">
        {loading && <div className="flex h-full items-center justify-center text-slate-400"><Loader2 className="animate-spin" size={18} /></div>}
        {error && <div className="p-4 text-sm text-rose-300">שגיאה: {error}</div>}
        {tree && !loading && (
          <Tree
            data={tree}
            orientation="horizontal"
            translate={translate}
            collapsible
            initialDepth={1}
            depthFactor={260}
            separation={{ siblings: 0.7, nonSiblings: 1 }}
            renderCustomNodeElement={renderNode}
            pathFunc="diagonal"
            pathClassFunc={() => 'catalog-link'}
            zoomable
            scaleExtent={{ min: 0.2, max: 2 }}
          />
        )}
      </div>
      <style jsx global>{`.catalog-link { stroke: #475569; stroke-width: 1px; fill: none; }`}</style>
    </div>
  )
}
