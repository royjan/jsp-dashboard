'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import nextDynamic from 'next/dynamic'
import { Loader2, Maximize2, X } from 'lucide-react'

/* eslint-disable @typescript-eslint/no-explicit-any */

// react-d3-tree touches window — load client-only.
const Tree = nextDynamic(() => import('react-d3-tree'), { ssr: false }) as any

/** Deep-link to the rules browser scoped to a catalog node (its scheme + name).
 *  The browser filters via free-text `q` (matches category/subcategory/schema) + `lambda`;
 *  status is pinned to approved+suggestion to match the catalog's rule counts (excludes rejected). */
function rulesHref(nodeDatum: any): string {
  const a = nodeDatum.attributes || {}
  const p = new URLSearchParams()
  if (a.kind !== 'lambda' && a.kind !== 'root' && nodeDatum.name && nodeDatum.name !== '(none)') p.set('q', nodeDatum.name)
  if (a.lambda) p.set('lambda', a.lambda)
  p.set('status', 'approved,suggestion')
  return `/chat/flow-decisions?${p.toString()}`
}
function openRules(nodeDatum: any) {
  if (typeof window !== 'undefined') window.open(rulesHref(nodeDatum), '_blank', 'noopener,noreferrer')
}

function renderNode({ nodeDatum, toggleNode }: any) {
  const a = nodeDatum.attributes || {}
  const isSchema = a.kind === 'schema'
  const isLambda = a.kind === 'lambda'
  const fill =
    a.kind === 'lambda' ? '#e879f9'          // manufacturer catalog (PSA / SAIC / Partslink)
    : a.kind === 'category' ? '#38bdf8'
    : a.kind === 'subcategory' ? '#818cf8'
    : a.kind === 'schema' ? (a.generic ? '#f59e0b' : '#34d399')
    : '#22d3ee'                              // root
  return (
    // stroke="none": react-d3-tree leaks an inherited black stroke onto <text>, which with
    // paint-order:normal paints over the light fill and renders labels near-black/unreadable.
    // Reset it here (the circle re-declares its own stroke below).
    // Leaf schema nodes have nothing to expand, so clicking them opens the rule list.
    <g stroke="none" style={{ cursor: 'pointer' }} onClick={isSchema ? () => openRules(nodeDatum) : toggleNode}>
      <title>{isSchema ? 'פתח את החוקים של סכמה זו' : 'לחץ לפתיחה/סגירה · לחץ על מספר החוקים לרשימה'}</title>
      <circle r={isLambda ? 9 : 7} fill={fill} stroke="#0f172a" strokeWidth={1.5} />
      {/* vertical (top→bottom) tree: center labels BELOW each node so long names
          don't collide with horizontal siblings */}
      <text fill="#e2e8f0" stroke="none" textAnchor="middle" x={0} dy={isLambda ? 26 : 22} fontSize={isLambda ? 13 : 12} style={{ fontWeight: isSchema ? 400 : isLambda ? 700 : 600 }}>{nodeDatum.name}</text>
      {a.rules != null && (
        // clickable on every node → opens the rule list for this node's scope
        <text
          fill={isLambda ? '#f0abfc' : '#7dd3fc'} stroke="none" textAnchor="middle" x={0} dy={isLambda ? 40 : 36} fontSize={10}
          style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
          onClick={(e) => { e.stopPropagation(); openRules(nodeDatum) }}
        >
          {a.rules} rules{a.pinned ? ` · ${a.pinned}📌` : ''} ↗
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
  const [full, setFull] = useState(false)

  useEffect(() => {
    fetch('/api/flow-decisions/catalog-tree')
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else setTree(d.tree) })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  // close fullscreen on Escape (matches the tracer graph)
  useEffect(() => {
    if (!full) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && setFull(false)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [full])

  // vertical tree: center horizontally, anchor near the top. Re-center whenever the tree
  // loads or the container resizes (fullscreen toggle).
  useEffect(() => {
    if (boxRef.current) {
      const { width } = boxRef.current.getBoundingClientRect()
      setTranslate({ x: Math.max(width / 2, 200), y: 60 })
    }
  }, [tree, full])

  const count = useMemo(() => tree?.attributes?.rules ?? 0, [tree])

  return (
    <div className="space-y-2">
      <div className="text-[12px] text-slate-400">
        {tree
          ? `${count} חוקים · ${tree.children?.length || 0} קטלוגים: ${(tree.children || []).map((c: any) => `${c.name} (${c.attributes?.rules ?? 0})`).join(' · ')} — לחץ צומת לפתיחה/סגירה · לחץ על «N rules ↗» לרשימת החוקים`
          : ''}
      </div>
      <div
        ref={boxRef}
        className={full
          ? 'fixed inset-0 z-[100] bg-slate-950'
          : 'relative h-[64vh] w-full rounded-lg border border-slate-700 bg-slate-900/40'}
      >
        <button
          onClick={() => setFull((v) => !v)}
          className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded-md border border-slate-600 bg-slate-800/90 px-2.5 py-1.5 text-[12px] text-slate-100 hover:bg-slate-700"
        >
          {full ? <><X size={13} /> סגור (Esc)</> : <><Maximize2 size={13} /> מסך מלא</>}
        </button>
        {loading && <div className="flex h-full items-center justify-center text-slate-400"><Loader2 className="animate-spin" size={18} /></div>}
        {error && <div className="p-4 text-sm text-rose-300">שגיאה: {error}</div>}
        {tree && !loading && (
          <Tree
            data={tree}
            orientation="vertical"
            translate={translate}
            collapsible
            initialDepth={1}
            depthFactor={130}
            separation={{ siblings: 1.6, nonSiblings: 2 }}
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
