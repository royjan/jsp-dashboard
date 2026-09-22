'use client'

import { useEffect, useRef } from 'react'
import { select } from 'd3-selection'
import { zoom, zoomIdentity } from 'd3-zoom'
import { drag as d3drag } from 'd3-drag'
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY,
  type SimulationNodeDatum, type SimulationLinkDatum,
} from 'd3-force'
import { familyChipClasses, type BrandFamily } from '@/lib/brand'

/**
 * The cross-brand graph: a d3 force layout with pan, zoom and drag.
 *
 * The same setup as the preview page this came from — brands pulled to the
 * right, codes to the left, a live simulation that settles while you watch
 * and reheats when you drag. d3 draws straight into the svg through a ref;
 * React owns the container and the data, nothing else, so a 150-node tick
 * never re-renders the tree.
 *
 * Node kinds: `fam` anchors (brand families, large discs) and `code` nodes
 * (item numbers, small discs with a label above and a Hebrew name below).
 * Links: `cars` (a brand prints the number; width by scanned cars), `equiv`
 * (same part, different number; dotted), `chain` (supersession; arrow) and
 * `erp` (the ERP's own chain; dashed arrow).
 *
 * `mode` picks the forces: 'root' is the wide bipartite map, 'lineage' the
 * tighter one-part view. Past `labelLimit` codes, labels wait for zoom or
 * hover so the picture stays readable when the set grows.
 */
export interface GNode extends SimulationNodeDatum {
  id: string
  kind: 'fam' | 'code'
  brand: BrandFamily | string
  label: string
  sub?: string | null
  root?: boolean
  fork?: boolean
  clickable?: boolean
  /** Opens in a new tab when the label is clicked. */
  href?: string
  /** How many scanned cars carry the code: the order nodes are revealed in on zoom. */
  rank?: number
}
export interface GLink { source: string; target: string; kind: 'cars' | 'equiv' | 'chain' | 'erp'; weight?: number }
type SimLink = SimulationLinkDatum<GNode> & { kind: GLink['kind']; weight?: number }

const COLORS: Record<string, string> = {
  PSA: '#2f6fdb', MG: '#1f9d6a', TOYOTA: '#d9486f', VOLVO: '#2a9fd8', FIAT: '#e07a1f',
  VAG: '#64748b', BMW: '#7c3aed', MITSUBISHI: '#dc2626', OTHER: '#8a94a6',
}
export const famColor = (f: string) => COLORS[f] ?? COLORS.OTHER

const W = 1040

export function CrossBrandGraph({
  nodes, links, onNodeClick, height = 720, mode = 'root', labelLimit = 45, detail,
}: {
  nodes: GNode[]; links: GLink[]; onNodeClick?: (n: GNode) => void
  height?: number; mode?: 'root' | 'lineage'; labelLimit?: number
  /**
   * Codes shown at normal zoom, busiest first; the rest are laid out but
   * hidden and appear as you zoom in (four times as many at 2x). Undefined
   * shows everything.
   */
  detail?: number
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const clickRef = useRef(onNodeClick)
  useEffect(() => { clickRef.current = onNodeClick }, [onNodeClick])

  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl) return
    const H = height
    const svg = select(svgEl)
    svg.selectAll('*').remove()
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

    // fresh objects per run: d3 mutates x/y/vx/vy on them
    const simNodes: GNode[] = nodes.map((n) => ({ ...n }))
    const byId = new Map(simNodes.map((n) => [n.id, n]))
    const simLinks: SimLink[] = links
      .filter((l) => byId.has(l.source) && byId.has(l.target))
      .map((l) => ({ source: l.source, target: l.target, kind: l.kind, weight: l.weight }))
    const codeCount = simNodes.filter((n) => n.kind === 'code').length
    // Reveal order: every code gets its place in the busiest-first ranking, and
    // the zoom level decides how far down that list is visible.
    const order = new Map<string, number>()
    simNodes.filter((n) => n.kind === 'code').sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0)).forEach((n, i) => order.set(n.id, i))
    let k = 1
    const visibleCount = () => detail == null ? codeCount : Math.min(codeCount, Math.round(detail * k * k))
    const isVisible = (n: GNode) => n.kind === 'fam' || (order.get(n.id) ?? 0) < visibleCount()
    const manyCodes = () => visibleCount() > labelLimit

    // ── zoom layer ──
    const layer = svg.append('g')
    const z = zoom<SVGSVGElement, unknown>().scaleExtent([0.35, 6]).on('zoom', (e) => {
      layer.attr('transform', e.transform.toString())
      const before = visibleCount(), labelsBefore = manyCodes() && k < 1.6
      k = e.transform.k
      if (visibleCount() !== before || (manyCodes() && k < 1.6) !== labelsBefore) refreshLabels()
    })
    svg.call(z).on('dblclick.zoom', () => svg.transition().duration(reduce ? 0 : 350).call(z.transform, zoomIdentity))

    svg.append('defs').append('marker')
      .attr('id', 'xb-arrow').attr('viewBox', '0 -4 8 8').attr('refX', 18)
      .attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-4L8,0L0,4').attr('fill', 'currentColor').attr('opacity', 0.6)

    // ── forces ──
    // Root: brands are pinned on a ring around the canvas and every code is
    // drawn toward the middle of the brands it touches — a code shared by PSA
    // and MG settles between them, a Volvo collision between Volvo and PSA —
    // so the whole canvas is used and the picture reads as a map. Lineage:
    // the preview's tighter layout, brands right, codes left.
    const root = mode === 'root'
    const fams = simNodes.filter((n) => n.kind === 'fam')
    const target = new Map<string, { x: number; y: number }>()
    if (root) {
      const R = Math.min(W, H) * 0.4
      fams.forEach((f, i) => {
        const a = -Math.PI / 2 + (i / Math.max(1, fams.length)) * Math.PI * 2
        f.fx = fams.length === 1 ? W / 2 : W / 2 + Math.cos(a) * R
        f.fy = fams.length === 1 ? H / 2 : H / 2 + Math.sin(a) * R
      })
      const famsOf = new Map<string, GNode[]>()
      for (const l of simLinks) {
        if (l.kind !== 'cars') continue
        const c = byId.get(String(l.source))!, f = byId.get(String(l.target))!
        const list = famsOf.get(c.id) ?? []; list.push(f); famsOf.set(c.id, list)
      }
      for (const n of simNodes) {
        if (n.kind !== 'code') continue
        const fs = famsOf.get(n.id) ?? []
        const mx = fs.length ? fs.reduce((s, f) => s + f.fx!, 0) / fs.length : W / 2
        const my = fs.length ? fs.reduce((s, f) => s + f.fy!, 0) / fs.length : H / 2
        // between the centre and its brands; a one-brand code sits closer to the brand
        const pull = fs.length > 1 ? 0.75 : 0.62
        target.set(n.id, { x: W / 2 + (mx - W / 2) * pull, y: H / 2 + (my - H / 2) * pull })
        n.x = target.get(n.id)!.x + (Math.random() - 0.5) * 80
        n.y = target.get(n.id)!.y + (Math.random() - 0.5) * 80
      }
    }
    const sim = forceSimulation<GNode>(simNodes)
      .force('link', forceLink<GNode, SimLink>(simLinks).id((d) => d.id)
        .distance((d) => d.kind === 'equiv' ? (root ? 60 : 140) : d.kind === 'cars' ? (root ? 160 : 90) : 105)
        .strength((d) => d.kind === 'equiv' ? 0.6 : root ? 0.05 : 0.5))
      .force('charge', forceManyBody().strength(root ? (codeCount > labelLimit ? -140 : -220) : -520))
      .force('collide', forceCollide<GNode>((d) => d.kind === 'fam' ? 40 : root ? (codeCount > labelLimit ? 15 : 24) : 46).strength(0.9))
    if (root) {
      sim.force('x', forceX<GNode>((d) => target.get(d.id)?.x ?? W / 2).strength(0.14))
         .force('y', forceY<GNode>((d) => target.get(d.id)?.y ?? H / 2).strength(0.14))
    } else {
      sim.force('center', forceCenter(W / 2, H / 2))
         .force('y', forceY(H / 2).strength(0.06))
    }

    // ── links ──
    // Edge width = how many scanned cars carry the part, on both kinds of edge.
    const width = (d: SimLink) => d.kind === 'chain' || d.kind === 'erp' ? 1.8 : Math.min(9, 1 + Math.log2((d.weight ?? 0) + 1) * 1.4)
    const baseOpacity = (d: SimLink) => d.kind === 'cars' ? (codeCount > labelLimit ? 0.35 : 0.55) : 0.9
    const link = layer.append('g').selectAll('line').data(simLinks).join('line')
      .attr('stroke', (d) => d.kind === 'cars' ? famColor(String((d.target as GNode).brand)) : d.kind === 'equiv' ? 'currentColor' : d.kind === 'erp' ? '#8a94a6' : '#2f6fdb')
      .attr('stroke-opacity', baseOpacity)
      .attr('stroke-width', width)
      .attr('stroke-dasharray', (d) => d.kind === 'erp' ? '6 4' : d.kind === 'equiv' ? '2 4' : null)
      .attr('marker-end', (d) => d.kind === 'chain' || d.kind === 'erp' ? 'url(#xb-arrow)' : null)

    // ── nodes ──
    const node = layer.append('g').selectAll<SVGGElement, GNode>('g').data(simNodes).join('g')
      .style('cursor', (d) => d.clickable ? 'pointer' : 'grab')
      .call(d3drag<SVGGElement, GNode>()
        .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y })
        // pinned brands stay where they are dropped; codes go back to the forces
        .on('end', (e, d) => { if (!e.active) sim.alphaTarget(0); if (!(root && d.kind === 'fam')) { d.fx = null; d.fy = null } }))
      .on('click', (e, d) => { if (e.defaultPrevented) return; if (d.clickable) clickRef.current?.(d) })

    const fam = node.filter((d) => d.kind === 'fam')
    fam.append('circle').attr('r', 22).attr('fill', (d) => famColor(String(d.brand))).attr('stroke', 'var(--background, #fff)').attr('stroke-width', 2)
    fam.append('text').attr('dy', 4).attr('text-anchor', 'middle').attr('font-size', 11).attr('font-weight', 600).style('fill', '#fff').attr('class', 'font-mono').text((d) => d.label)
    fam.filter((d) => !!d.sub).append('text').attr('dy', 36).attr('text-anchor', 'middle').attr('font-size', 10).attr('class', 'font-mono fill-muted-foreground').text((d) => d.sub!)

    const code = node.filter((d) => d.kind === 'code')
    code.append('circle')
      .attr('r', (d) => d.root ? 12 : codeCount > labelLimit ? 7 : 9)
      .attr('fill', (d) => d.fork ? '#d94141' : famColor(String(d.brand)))
      .attr('stroke', (d) => d.root ? 'currentColor' : 'var(--background, #fff)')
      .attr('stroke-width', (d) => d.root ? 3 : 2)
    const halo = { 'paint-order': 'stroke', stroke: 'var(--background, #fff)', 'stroke-width': 3, 'stroke-linejoin': 'round' } as const
    const titled = code.filter((d) => !d.href)
    const titleText = titled.append('text').attr('dy', -14).attr('text-anchor', 'middle').attr('font-size', 11)
      .attr('font-weight', (d) => d.root ? 600 : 400).attr('class', 'font-mono fill-foreground').text((d) => d.label)
    Object.entries(halo).forEach(([a, v]) => titleText.attr(a, v as string))
    const linked = code.filter((d) => !!d.href).append('a')
      .attr('href', (d) => d.href!).attr('target', '_blank').attr('rel', 'noopener noreferrer')
      .on('pointerdown', (e) => e.stopPropagation()).on('click', (e) => e.stopPropagation())
    const linkText = linked.append('text').attr('dy', -16).attr('text-anchor', 'middle').attr('font-size', 11).attr('font-weight', 600)
      .attr('class', 'font-mono fill-primary').attr('text-decoration', 'underline').text((d) => `${d.label} ↗`)
    Object.entries(halo).forEach(([a, v]) => linkText.attr(a, v as string))
    const subText = code.filter((d) => !!d.sub).append('text').attr('dy', 26).attr('text-anchor', 'middle').attr('font-size', 10)
      .attr('direction', 'rtl').attr('class', 'fill-muted-foreground').text((d) => d.sub!)
    Object.entries(halo).forEach(([a, v]) => subText.attr(a, v as string))
    node.append('title').text((d) => `${d.label}${d.sub ? `\n${d.sub}` : ''}${d.clickable ? '\nclick to open' : ''}`)

    // ── labels: always for a small set; on zoom or hover for a large one ──
    let hovered: string | null = null
    const neighbours = (id: string) => {
      const s = new Set([id])
      for (const l of simLinks) { const a = (l.source as GNode).id, b = (l.target as GNode).id; if (a === id) s.add(b); if (b === id) s.add(a) }
      return s
    }
    function refreshLabels() {
      const near = hovered ? neighbours(hovered) : null
      const show = (d: GNode) => d.kind === 'fam' || !!d.root || !manyCodes() || k >= 1.6 || (near?.has(d.id) ?? false)
      // reveal: nodes past the zoom's reach are laid out but not drawn, nor their edges
      node.style('display', (d) => isVisible(d) ? null : 'none')
      link.style('display', (d) => isVisible(d.source as GNode) && isVisible(d.target as GNode) ? null : 'none')
      code.selectAll<SVGTextElement, GNode>('text').style('display', function () {
        const d = select<SVGGElement, GNode>(this.closest('g') as SVGGElement).datum()
        return show(d) ? null : 'none'
      })
      node.attr('opacity', (d) => near && !near.has(d.id) ? 0.25 : 1)
      link.attr('stroke-opacity', (d) => {
        if (!near) return baseOpacity(d)
        const a = (d.source as GNode).id, b = (d.target as GNode).id
        return a === hovered || b === hovered ? 0.95 : 0.06
      })
    }
    node.on('pointerenter', (e, d) => { hovered = d.id; refreshLabels() })
        .on('pointerleave', (e, d) => { if (hovered === d.id) { hovered = null; refreshLabels() } })
    refreshLabels()

    sim.on('tick', () => {
      link.attr('x1', (d) => (d.source as GNode).x!).attr('y1', (d) => (d.source as GNode).y!)
          .attr('x2', (d) => (d.target as GNode).x!).attr('y2', (d) => (d.target as GNode).y!)
      node.attr('transform', (d) => `translate(${d.x},${d.y})`)
    })
    if (reduce) { sim.stop(); for (let i = 0; i < 300; i++) sim.tick(); sim.on('tick')?.call(sim) }

    return () => { sim.stop() }
  }, [nodes, links, height, mode, labelLimit, detail])

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${height}`}
      className="w-full h-auto rounded-md bg-muted/40 touch-none select-none"
      role="img"
      aria-label="cross-brand relations graph"
    />
  )
}

/** A small legend chip in the family colour, for the page's legend row. */
export function FamilyChip({ family }: { family: BrandFamily | string }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${familyChipClasses(family)}`}>{family}</span>
}
