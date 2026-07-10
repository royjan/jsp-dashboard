'use client'

// Liquidation Map — one interactive visual over the eBay candidates, two lenses:
//   • "מפת כסף" (treemap, default): rect area = capital tied (price × stock),
//     color = deadness (green=selling → red=dead). The CEO view: a map of money.
//   • "פיזור" (quadrant scatter): x = deadness, y = price (log), bubble = stock,
//     color = ship size. The analyst view: every part is its own dot.
// Canvas-rendered (2.6k marks — SVG would crawl), theme-aware, hover tooltip,
// click → item page, PNG export for slides/WhatsApp.
//
// Palette validated with the dataviz six-checks (light + dark surfaces):
//   categorical  light #10b981/#f59e0b · dark #059669/#d97706
//   diverging    #059669 ↔ neutral ↔ #dc2626 (both surfaces)
// Light-mode categorical is sub-3:1 vs surface (WARN) — mitigated by the 1.5px
// surface ring on every mark, the legend, tooltips, and the adjacent table view.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type MapRow = {
  code: string; name: string; size: 'small' | 'medium'
  price: number; stock: number
  sold_this_year: number; sold_2025: number; sold_2024: number
  years_of_stock: number; deadness: number; match: number
}

type Mode = 'treemap' | 'scatter'
type Rect = { x: number; y: number; w: number; h: number; row: MapRow | null; value: number; count?: number }
type Dot = { x: number; y: number; r: number; row: MapRow }

const nf = (n: number) => Math.round(n).toLocaleString('en-US')
const shekAbbr = (n: number) => n >= 1000 ? `₪${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : `₪${Math.round(n)}`

function theme(dark: boolean) {
  return dark ? {
    surface: '#1a1d25', ink: '#e9e7e1', dim: '#9a9da6', grid: '#2b2f3a',
    small: '#059669', medium: '#d97706',
    divLo: [5, 150, 105] as const, divMid: [107, 114, 128] as const, divHi: [220, 38, 38] as const,
    accentTint: 'rgba(63,167,179,0.07)',
  } : {
    surface: '#ffffff', ink: '#1d1e21', dim: '#63656d', grid: '#e5e2d9',
    small: '#10b981', medium: '#f59e0b',
    divLo: [5, 150, 105] as const, divMid: [156, 163, 175] as const, divHi: [220, 38, 38] as const,
    accentTint: 'rgba(31,123,135,0.06)',
  }
}
type Theme = ReturnType<typeof theme>

// deadness 0..100 → green→neutral→red (diverging, neutral midpoint at 50)
function deadColor(t: Theme, d: number): string {
  const f = Math.max(0, Math.min(1, d / 100))
  const lerp = (a: readonly number[], b: readonly number[], k: number) =>
    `rgb(${Math.round(a[0] + (b[0] - a[0]) * k)},${Math.round(a[1] + (b[1] - a[1]) * k)},${Math.round(a[2] + (b[2] - a[2]) * k)})`
  return f < 0.5 ? lerp(t.divLo, t.divMid, f * 2) : lerp(t.divMid, t.divHi, (f - 0.5) * 2)
}

// ── squarified treemap (Bruls et al.) ────────────────────────────────────────
function squarify(values: number[], x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = []
  let i = 0
  while (i < values.length) {
    const horiz = w >= h
    const side = horiz ? h : w
    let rowSum = 0, worst = Infinity, n = 0
    // grow the row while the worst aspect ratio improves
    for (let j = i; j < values.length; j++) {
      const sum = rowSum + values[j]
      const rowThick = sum / side
      let wst = 0
      for (let k = i; k <= j; k++) {
        const len = values[k] / rowThick
        wst = Math.max(wst, rowThick / len, len / rowThick)
      }
      if (wst > worst) break
      worst = wst; rowSum = sum; n = j - i + 1
    }
    const thick = rowSum / side
    let off = 0
    for (let k = i; k < i + n; k++) {
      const len = values[k] / thick
      out.push(horiz
        ? { x, y: y + off, w: thick, h: len }
        : { x: x + off, y, w: len, h: thick })
      off += len
    }
    if (horiz) { x += thick; w -= thick } else { y += thick; h -= thick }
    i += n
  }
  return out
}

function layoutTreemap(rows: MapRow[], W: number, H: number): Rect[] {
  const sorted = [...rows].sort((a, b) => b.price * b.stock - a.price * a.stock)
  const total = sorted.reduce((s, r) => s + r.price * r.stock, 0)
  if (!total || !sorted.length) return []
  const area = W * H
  // render individually only rects big enough to see; fold the tail into "אחר"
  const MIN_PX = 64
  const keep: MapRow[] = []; let tailValue = 0; let tailCount = 0
  for (const r of sorted) {
    const v = r.price * r.stock
    if ((v / total) * area >= MIN_PX && keep.length < 600) keep.push(r)
    else { tailValue += v; tailCount++ }
  }
  const values = keep.map(r => (r.price * r.stock / total) * area)
  if (tailValue > 0) values.push((tailValue / total) * area)
  const rects = squarify(values, 0, 0, W, H)
  return rects.map((g, i) => i < keep.length
    ? { ...g, row: keep[i], value: keep[i].price * keep[i].stock }
    : { ...g, row: null, value: tailValue, count: tailCount })
}

// ── scatter layout ───────────────────────────────────────────────────────────
const M = { top: 26, right: 14, bottom: 42, left: 58 }
function layoutScatter(rows: MapRow[], W: number, H: number, maxPrice: number): Dot[] {
  const pw = W - M.left - M.right, ph = H - M.top - M.bottom
  const yMin = Math.log(900), yMax = Math.log(maxPrice * 1.15)
  return rows.map(r => ({
    x: M.left + (r.deadness / 100) * pw,
    y: M.top + ph - ((Math.log(Math.max(r.price, 900)) - yMin) / (yMax - yMin)) * ph,
    r: Math.max(3, Math.min(16, Math.sqrt(r.stock) * 1.7)),
    row: r,
  }))
}

// ── shared renderer (screen + PNG export) ────────────────────────────────────
function render(ctx: CanvasRenderingContext2D, W: number, H: number, mode: Mode,
  t: Theme, rects: Rect[], dots: Dot[], maxPrice: number, hoverCode: string | null) {
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = t.surface; ctx.fillRect(0, 0, W, H)
  const font = (px: number, bold = false) => { ctx.font = `${bold ? '600 ' : ''}${px}px -apple-system, "Segoe UI", sans-serif` }

  if (mode === 'treemap') {
    for (const rc of rects) {
      const pad = 1 // 2px gap between fills (1px each side)
      const x = rc.x + pad, y = rc.y + pad, w = Math.max(0, rc.w - 2 * pad), h = Math.max(0, rc.h - 2 * pad)
      if (w < 1 || h < 1) continue
      ctx.fillStyle = rc.row ? deadColor(t, rc.row.deadness) : t.grid
      ctx.fillRect(x, y, w, h)
      if (rc.row && hoverCode === rc.row.code) { ctx.strokeStyle = t.ink; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2) }
      // labels only where they fit
      if (w >= 62 && h >= 34) {
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip()
        ctx.fillStyle = 'rgba(255,255,255,0.95)'
        ctx.textAlign = 'right'; ctx.direction = 'rtl'
        if (rc.row) {
          font(11, true); ctx.fillText(rc.row.name.slice(0, Math.floor(w / 7)), x + w - 6, y + 15)
          font(11); ctx.fillText(`${shekAbbr(rc.value)}${rc.row.stock > 1 ? ` ×${rc.row.stock}` : ''}`, x + w - 6, y + 29)
        } else {
          font(11, true); ctx.fillText(`אחר (${nf(rc.count || 0)} פריטים)`, x + w - 6, y + 15)
          font(11); ctx.fillText(shekAbbr(rc.value), x + w - 6, y + 29)
        }
        ctx.restore(); ctx.direction = 'ltr'
      }
    }
    return
  }

  // scatter
  const pw = W - M.left - M.right, ph = H - M.top - M.bottom
  const yMin = Math.log(900), yMax = Math.log(maxPrice * 1.15)
  const yOf = (p: number) => M.top + ph - ((Math.log(p) - yMin) / (yMax - yMin)) * ph
  const xOf = (d: number) => M.left + (d / 100) * pw
  // quadrant tint (top-right = the eBay corner) + threshold lines
  const qx = xOf(50), qy = yOf(3000)
  ctx.fillStyle = t.accentTint; ctx.fillRect(qx, M.top, W - M.right - qx, qy - M.top)
  ctx.strokeStyle = t.grid; ctx.lineWidth = 1
  ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(qx, M.top); ctx.lineTo(qx, H - M.bottom); ctx.moveTo(M.left, qy); ctx.lineTo(W - M.right, qy); ctx.stroke(); ctx.setLineDash([])
  // grid + axes
  const priceTicks = [1000, 2000, 5000, 10000, 20000, 40000].filter(p => p <= maxPrice * 1.15)
  ctx.textAlign = 'right'; ctx.fillStyle = t.dim; font(10.5)
  for (const p of priceTicks) {
    const y = yOf(p)
    ctx.strokeStyle = t.grid; ctx.beginPath(); ctx.moveTo(M.left, y); ctx.lineTo(W - M.right, y); ctx.stroke()
    ctx.fillText(shekAbbr(p), M.left - 7, y + 3.5)
  }
  ctx.textAlign = 'center'
  for (const d of [0, 25, 50, 75, 100]) ctx.fillText(String(d), xOf(d), H - M.bottom + 16)
  ctx.direction = 'rtl'; font(11, true); ctx.fillStyle = t.dim
  ctx.fillText('→ מדד מלאי-מת (0 = נמכר · 100 = מת)', W / 2, H - 8)
  // quadrant captions
  font(10.5, true)
  ctx.fillStyle = t.ink; ctx.textAlign = 'right'
  ctx.fillText('💰 מלאי מת ויקר — למכור ב-eBay', W - M.right - 8, M.top + 14)
  ctx.fillStyle = t.dim
  ctx.textAlign = 'left'; ctx.fillText('יקר אבל נמכר — להשאיר בארץ', M.left + 8, M.top + 14)
  ctx.textAlign = 'right'; ctx.fillText('מת אבל זול', W - M.right - 8, H - M.bottom - 8)
  ctx.textAlign = 'left'; ctx.fillText('בריא — לא רלוונטי', M.left + 8, H - M.bottom - 8)
  ctx.direction = 'ltr'
  // marks: fill + 1.5px surface ring (spacer on overlap)
  for (const d of dots) {
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
    ctx.fillStyle = d.row.size === 'small' ? t.small : t.medium
    ctx.globalAlpha = 0.88; ctx.fill(); ctx.globalAlpha = 1
    ctx.lineWidth = 1.5; ctx.strokeStyle = t.surface; ctx.stroke()
    if (hoverCode === d.row.code) { ctx.lineWidth = 2; ctx.strokeStyle = t.ink; ctx.stroke() }
  }
}

// ── component ────────────────────────────────────────────────────────────────
export function LiquidationMap({ rows }: { rows: MapRow[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<Mode>('treemap')
  const [dark, setDark] = useState(false)
  const [dims, setDims] = useState({ w: 900, h: 520 })
  const [hover, setHover] = useState<{ px: number; py: number; row: MapRow } | null>(null)

  // theme detection (next-themes toggles the 'dark' class on <html>)
  useEffect(() => {
    const el = document.documentElement
    const read = () => setDark(el.classList.contains('dark') ||
      (!el.classList.contains('light') && window.matchMedia('(prefers-color-scheme: dark)').matches))
    read()
    const mo = new MutationObserver(read); mo.observe(el, { attributes: true, attributeFilter: ['class'] })
    const mq = window.matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', read)
    return () => { mo.disconnect(); mq.removeEventListener('change', read) }
  }, [])

  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver(es => {
      const w = es[0].contentRect.width
      if (w > 0) setDims({ w, h: Math.max(420, Math.min(560, w * 0.55)) })
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const t = useMemo(() => theme(dark), [dark])
  const maxPrice = useMemo(() => Math.max(...rows.map(r => r.price), 2000), [rows])
  const rects = useMemo(() => mode === 'treemap' ? layoutTreemap(rows, dims.w, dims.h) : [], [rows, dims, mode])
  const dots = useMemo(() => mode === 'scatter' ? layoutScatter(rows, dims.w, dims.h, maxPrice) : [], [rows, dims, mode, maxPrice])
  const capital = useMemo(() => rows.reduce((s, r) => s + r.price * r.stock, 0), [rows])

  // draw
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = dims.w * dpr; cv.height = dims.h * dpr
    cv.style.width = `${dims.w}px`; cv.style.height = `${dims.h}px`
    const ctx = cv.getContext('2d'); if (!ctx) return
    ctx.scale(dpr, dpr)
    render(ctx, dims.w, dims.h, mode, t, rects, dots, maxPrice, hover?.row.code ?? null)
  }, [dims, mode, t, rects, dots, maxPrice, hover])

  const hitTest = useCallback((mx: number, my: number): MapRow | null => {
    if (mode === 'treemap') {
      for (const rc of rects) if (rc.row && mx >= rc.x && mx <= rc.x + rc.w && my >= rc.y && my <= rc.y + rc.h) return rc.row
      return null
    }
    let best: Dot | null = null; let bestD = Infinity
    for (const d of dots) {
      const dist = Math.hypot(mx - d.x, my - d.y)
      if (dist <= Math.max(d.r + 4, 10) && dist < bestD) { best = d; bestD = dist }
    }
    return best?.row ?? null
  }, [mode, rects, dots])

  const onMove = (e: React.MouseEvent) => {
    const b = canvasRef.current!.getBoundingClientRect()
    const row = hitTest(e.clientX - b.left, e.clientY - b.top)
    setHover(row ? { px: e.clientX - b.left, py: e.clientY - b.top, row } : null)
  }

  const exportPng = () => {
    const S = 2, W = 1400, H = 860, PAD = 40, HEAD = 92
    const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S
    const ctx = cv.getContext('2d')!; ctx.scale(S, S)
    ctx.fillStyle = t.surface; ctx.fillRect(0, 0, W, H)
    ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.fillStyle = t.ink
    ctx.font = '600 22px -apple-system, "Segoe UI", sans-serif'
    ctx.fillText(mode === 'treemap' ? 'מפת כסף — מלאי מת למכירה ב-eBay' : 'מפת פיזור — מלאי מת למכירה ב-eBay', W - PAD, 38)
    ctx.font = '13px -apple-system, "Segoe UI", sans-serif'; ctx.fillStyle = t.dim
    ctx.fillText(`${nf(rows.length)} פריטים · ₪${nf(capital)} תקוע במלאי · ${new Date().toLocaleDateString('he-IL')}`, W - PAD, 62)
    ctx.fillText(mode === 'treemap' ? 'שטח = כסף תקוע (מחיר × מלאי) · ירוק = נמכר · אדום = מת' : 'ימינה = מת יותר · למעלה = יקר יותר · גודל עיגול = מלאי · ירוק = קטן, כתום = בינוני', W - PAD, 80)
    ctx.direction = 'ltr'
    ctx.save(); ctx.translate(PAD, HEAD)
    const iw = W - 2 * PAD, ih = H - HEAD - PAD
    render(ctx, iw, ih, mode, t,
      mode === 'treemap' ? layoutTreemap(rows, iw, ih) : [],
      mode === 'scatter' ? layoutScatter(rows, iw, ih, maxPrice) : [], maxPrice, null)
    ctx.restore()
    const a = document.createElement('a')
    a.download = `ebay-liquidation-map-${new Date().toISOString().slice(0, 10)}.png`
    a.href = cv.toDataURL('image/png'); a.click()
  }

  const h = hover?.row
  const flipTip = hover ? hover.px > dims.w - 260 : false

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex rounded-lg border overflow-hidden text-sm">
          <button onClick={() => setMode('treemap')} className={`px-3.5 py-1.5 ${mode === 'treemap' ? 'bg-primary text-primary-foreground font-bold' : 'bg-muted/40'}`}>מפת כסף</button>
          <button onClick={() => setMode('scatter')} className={`px-3.5 py-1.5 ${mode === 'scatter' ? 'bg-primary text-primary-foreground font-bold' : 'bg-muted/40'}`}>פיזור</button>
        </div>
        {mode === 'treemap' ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>נמכר</span>
            <span className="h-2.5 w-28 rounded-full" style={{ background: `linear-gradient(to left, ${deadColor(t, 0)}, ${deadColor(t, 50)}, ${deadColor(t, 100)})` }} />
            <span>מת</span>
            <span className="ms-2">· שטח = כסף תקוע (מחיר × מלאי)</span>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.small }} />קטן</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: t.medium }} />בינוני</span>
            <span>· גודל עיגול = כמות במלאי</span>
          </div>
        )}
        <button onClick={exportPng} className="ms-auto rounded-lg border bg-muted/40 px-3.5 py-1.5 text-sm hover:bg-muted">📷 הורד כתמונה</button>
      </div>

      <div ref={wrapRef} className="relative rounded-xl border overflow-hidden" style={{ background: t.surface }}>
        <canvas
          ref={canvasRef}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={() => { if (h) window.open(`/items/${encodeURIComponent(h.code)}`, '_blank') }}
          style={{ cursor: h ? 'pointer' : 'default', display: 'block' }}
        />
        {h && (
          <div
            dir="rtl"
            className="pointer-events-none absolute z-10 w-60 rounded-lg border bg-card p-3 text-xs shadow-lg"
            style={{ top: Math.min(hover!.py + 14, dims.h - 190), ...(flipTip ? { right: dims.w - hover!.px + 12 } : { left: hover!.px + 12 }) }}
          >
            <div className="font-bold text-sm mb-0.5">{h.name}</div>
            <div className="font-mono text-muted-foreground mb-1.5" dir="ltr" style={{ textAlign: 'right' }}>{h.code}</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
              <span className="text-muted-foreground">מחיר</span><span>₪{nf(h.price)}</span>
              <span className="text-muted-foreground">מלאי</span><span>{h.stock}</span>
              <span className="text-muted-foreground">כסף תקוע</span><span className="font-bold">₪{nf(h.price * h.stock)}</span>
              <span className="text-muted-foreground">נמכר 26/25/24</span><span>{h.sold_this_year} / {h.sold_2025} / {h.sold_2024}</span>
              <span className="text-muted-foreground">שנות מלאי</span><span>{h.years_of_stock >= 100 ? '∞' : h.years_of_stock}</span>
              <span className="text-muted-foreground">מדד מלאי-מת</span><span>{h.deadness}</span>
              <span className="text-muted-foreground">ציון התאמה</span><span className="font-bold">{h.match}</span>
            </div>
            <div className="mt-1.5 text-muted-foreground">לחיצה — דף פריט ↗</div>
          </div>
        )}
      </div>
    </div>
  )
}
