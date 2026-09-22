'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { familyChipClasses, type BrandFamily } from '@/lib/brand'

/**
 * A small force-directed graph with pan, zoom and drag — no library.
 *
 * Two node kinds: `fam` anchors (brand families, drawn as large discs) and
 * `code` nodes (item numbers, small discs with a label above and a Hebrew
 * name below). Links are either `cars` (a brand prints the number; width by
 * scanned cars), `equiv` (same part, different number; dotted), `chain`
 * (supersession; arrow, dashed for the ERP's own chain).
 *
 * Why no d3: the dashboard does not ship d3-force, and a spring-electric
 * layout for a few hundred nodes is forty lines. Families are pulled to the
 * right, codes to the left, so the picture reads as a bipartite map even
 * before it settles.
 */
export interface GNode {
  id: string
  kind: 'fam' | 'code'
  brand: BrandFamily | string
  label: string
  sub?: string | null
  /** true when the node is the current subject of the view */
  root?: boolean
  fork?: boolean
  clickable?: boolean
  /** Opens in a new tab when the label is clicked. */
  href?: string
  x?: number; y?: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null
}
export interface GLink { source: string; target: string; kind: 'cars' | 'equiv' | 'chain' | 'erp'; weight?: number }

const COLORS: Record<string, string> = {
  PSA: '#2f6fdb', MG: '#1f9d6a', TOYOTA: '#d9486f', VOLVO: '#2a9fd8', FIAT: '#e07a1f',
  VAG: '#64748b', BMW: '#7c3aed', MITSUBISHI: '#dc2626', OTHER: '#8a94a6',
}
export const famColor = (f: string) => COLORS[f] ?? COLORS.OTHER

export function CrossBrandGraph({
  nodes: inputNodes, links: inputLinks, onNodeClick, height = 560,
}: {
  nodes: GNode[]; links: GLink[]; onNodeClick?: (n: GNode) => void; height?: number
}) {
  const W = 1040, H = height
  const svgRef = useRef<SVGSVGElement>(null)
  const [, force] = useState(0)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const drag = useRef<{ node?: GNode; panning?: boolean; sx: number; sy: number; ox: number; oy: number } | null>(null)

  // Positions live on the node objects; a new node set restarts the layout.
  const sim = useMemo(() => {
    const byId = new Map(inputNodes.map((n) => [n.id, n]))
    const nodes = inputNodes
    const links = inputLinks
      .map((l) => ({ ...l, s: byId.get(l.source)!, t: byId.get(l.target)! }))
      .filter((l) => l.s && l.t)
    nodes.forEach((n, i) => {
      if (n.x == null) {
        const col = n.kind === 'fam' ? W * 0.74 : W * 0.3
        n.x = col + (Math.random() - 0.5) * 120
        n.y = H / 2 + (i - nodes.length / 2) * (H / Math.max(6, nodes.length)) + (Math.random() - 0.5) * 40
      }
      n.vx = 0; n.vy = 0
    })
    return { nodes, links, alpha: 1 }
  }, [inputNodes, inputLinks, H])

  useEffect(() => {
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    const tick = () => {
      const { nodes, links } = sim
      const a = sim.alpha
      // repulsion
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const p = nodes[i], q = nodes[j]
        let dx = q.x! - p.x!, dy = q.y! - p.y!
        let d2 = dx * dx + dy * dy; if (d2 < 1) { dx = 1; dy = 0; d2 = 1 }
        const min = (p.kind === 'fam' ? 30 : 22) + (q.kind === 'fam' ? 30 : 22)
        const f = (-900 * a) / d2 + (d2 < min * min ? (min - Math.sqrt(d2)) * 0.15 : 0) / Math.sqrt(d2)
        p.vx! -= dx * f; p.vy! -= dy * f; q.vx! += dx * f; q.vy! += dy * f
      }
      // springs
      for (const l of links) {
        const rest = l.kind === 'equiv' ? 80 : l.kind === 'cars' ? 140 : 105
        const dx = l.t.x! - l.s.x!, dy = l.t.y! - l.s.y!
        const d = Math.max(1, Math.hypot(dx, dy))
        const f = ((d - rest) / d) * 0.05 * a
        l.s.vx! += dx * f; l.s.vy! += dy * f; l.t.vx! -= dx * f; l.t.vy! -= dy * f
      }
      // anchors: families right, codes left, everyone toward the middle height
      for (const n of nodes) {
        const tx = n.kind === 'fam' ? W * 0.74 : W * 0.3
        n.vx! += (tx - n.x!) * 0.02 * a
        n.vy! += (H / 2 - n.y!) * 0.006 * a
        if (n.fx != null) { n.x = n.fx; n.y = n.fy!; n.vx = 0; n.vy = 0; continue }
        n.vx! *= 0.6; n.vy! *= 0.6
        n.x! += n.vx!; n.y! += n.vy!
      }
      sim.alpha = Math.max(0.02, a * 0.985)
      force((v) => v + 1)
      if (sim.alpha > 0.021 || drag.current?.node) raf = requestAnimationFrame(tick)
    }
    if (reduce) { for (let i = 0; i < 260; i++) tick(); cancelAnimationFrame(raf) } else raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [sim, H])

  // pointer handling: node drag, background pan, wheel zoom
  const toLocal = (e: React.PointerEvent | React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    const sx = ((e.clientX - r.left) / r.width) * W, sy = ((e.clientY - r.top) / r.height) * H
    return { sx, sy, x: (sx - view.x) / view.k, y: (sy - view.y) / view.k }
  }
  const onPointerDown = (e: React.PointerEvent, node?: GNode) => {
    const p = toLocal(e)
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    drag.current = node
      ? { node, sx: p.sx, sy: p.sy, ox: node.x!, oy: node.y! }
      : { panning: true, sx: p.sx, sy: p.sy, ox: view.x, oy: view.y }
    if (node) { node.fx = node.x; node.fy = node.y; sim.alpha = Math.max(sim.alpha, 0.3) }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return
    const p = toLocal(e)
    if (d.node) { d.node.fx = d.ox + (p.sx - d.sx) / view.k; d.node.fy = d.oy + (p.sy - d.sy) / view.k; d.node.x = d.node.fx; d.node.y = d.node.fy; force((v) => v + 1) }
    else setView((v) => ({ ...v, x: d.ox + (p.sx - d.sx), y: d.oy + (p.sy - d.sy) }))
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return
    const p = toLocal(e)
    const moved = Math.hypot(p.sx - d.sx, p.sy - d.sy) > 4
    if (d.node) { d.node.fx = null; d.node.fy = null; if (!moved && d.node.clickable && onNodeClick) onNodeClick(d.node) }
    drag.current = null
  }
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const p = toLocal(e)
    const k = Math.min(5, Math.max(0.35, view.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
    setView({ k, x: p.sx - (p.sx - view.x) * (k / view.k), y: p.sy - (p.sy - view.y) * (k / view.k) })
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto rounded-md bg-muted/40 touch-none select-none"
      onPointerDown={(e) => onPointerDown(e)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onDoubleClick={() => setView({ x: 0, y: 0, k: 1 })}
      role="img"
      aria-label="cross-brand relations graph"
    >
      <defs>
        <marker id="xb-arrow" viewBox="0 -4 8 8" refX="18" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,-4L8,0L0,4" className="fill-muted-foreground" />
        </marker>
      </defs>
      <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
        {sim.links.map((l, i) => (
          <line
            key={i}
            x1={l.s.x} y1={l.s.y} x2={l.t.x} y2={l.t.y}
            stroke={l.kind === 'cars' ? famColor(String(l.t.brand)) : l.kind === 'equiv' ? 'currentColor' : l.kind === 'erp' ? '#8a94a6' : '#2f6fdb'}
            strokeOpacity={l.kind === 'cars' ? 0.5 : 0.9}
            strokeWidth={l.kind === 'cars' ? Math.min(10, 1 + Math.log2((l.weight ?? 0) + 1) * 2) : 1.8}
            strokeDasharray={l.kind === 'equiv' ? '2 4' : l.kind === 'erp' ? '6 4' : undefined}
            markerEnd={l.kind === 'chain' || l.kind === 'erp' ? 'url(#xb-arrow)' : undefined}
          />
        ))}
        {sim.nodes.map((n) => (
          <g
            key={n.id}
            transform={`translate(${n.x},${n.y})`}
            onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, n) }}
            style={{ cursor: n.clickable ? 'pointer' : 'grab' }}
          >
            {n.kind === 'fam' ? (
              <>
                <circle r={22} fill={famColor(String(n.brand))} fillOpacity={n.root ? 1 : 0.9} />
                <text dy={4} textAnchor="middle" fontSize={11} fontWeight={600} fill="#fff" className="font-mono">{n.label}</text>
                {n.sub && <text dy={36} textAnchor="middle" fontSize={10} className="fill-muted-foreground font-mono">{n.sub}</text>}
              </>
            ) : (
              <>
                <circle
                  r={n.root ? 12 : 9}
                  fill={n.fork ? '#d94141' : famColor(String(n.brand))}
                  stroke={n.root ? 'currentColor' : 'var(--background, #fff)'}
                  strokeWidth={n.root ? 3 : 2}
                />
                {n.href ? (
                  <a href={n.href} target="_blank" rel="noopener noreferrer" onPointerDown={(e) => e.stopPropagation()}>
                    <text dy={-16} textAnchor="middle" fontSize={11} fontWeight={600} className="font-mono fill-primary underline">{n.label} ↗</text>
                  </a>
                ) : (
                  <text dy={-16} textAnchor="middle" fontSize={11} fontWeight={n.root ? 600 : 400} className="font-mono fill-foreground">{n.label}</text>
                )}
                {n.sub && <text dy={26} textAnchor="middle" fontSize={11} direction="rtl" className="fill-muted-foreground">{n.sub}</text>}
              </>
            )}
            <title>{`${n.label}${n.sub ? `\n${n.sub}` : ''}${n.clickable ? '\nclick to open' : ''}`}</title>
          </g>
        ))}
      </g>
    </svg>
  )
}

/** A small legend chip in the family colour, for the page's legend row. */
export function FamilyChip({ family }: { family: BrandFamily | string }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${familyChipClasses(family)}`}>{family}</span>
}
