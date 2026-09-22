'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Shuffle, ArrowLeft, ArrowRight, ExternalLink, Search } from 'lucide-react'
import { PageHeader } from '@/components/shared/PageHeader'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useLocale } from '@/lib/locale-context'
import { ERP_FAMILIES, FAMILY_LABEL_HE, familySlug, type BrandFamily } from '@/lib/brand'
import { CrossBrandGraph, FamilyChip, type GLink, type GNode } from '@/components/catalog/CrossBrandGraph'

/**
 * /catalog/cross-brand — one graph of every cross-brand relation.
 *
 * Root view: item numbers printed by more than one brand (a shared numbering
 * scheme or a collision) and matched pairs that are the same part under two
 * numbers. Clicking a code redraws the same canvas as that part's lineage —
 * its ERP and catalog chains, its equivalents, and the brands that print it —
 * with the title linking to the item page. Back walks the stack.
 */

interface CodeRel { code: string; brand: BrandFamily; heb: string | null; fams: Record<string, number>; shared_numbering: boolean; in_erp: boolean; stock: number }
interface MatchRel { a: string; aBrand: BrandFamily; aHeb: string | null; aInErp: boolean; aStock: number; aCars: number; b: string; bBrand: BrandFamily; bHeb: string | null; bInErp: boolean; bStock: number; bCars: number; source: string }

/** Catalog names run to "קסוות מיסב ראשי | דיזל DW10FDCU/UE63 2 ל' | …"; the graph shows the first segment. */
const shortName = (s: string | null | undefined) => {
  const first = (s ?? '').split(' | ')[0].trim()
  return first.length > 28 ? first.slice(0, 27) + '…' : first
}
interface RootPayload {
  codes: CodeRel[]; matches: MatchRel[]
  totals: { codes: number; matches: number; unique_codes: number; in_erp: number; in_stock: number }
  brandTotals: Record<string, { parts: number; cross: number }>
  truncated: boolean; computedAt: string
}

/** The brand a bare code most likely belongs to, for opening a code typed into the search box. */
const guessBrand = (code: string): BrandFamily =>
  code.startsWith('SU0') ? 'TOYOTA' : /^MG\d/.test(code) ? 'MG' : 'PSA'

type Kind = 'all' | 'collisions' | 'shared' | 'matches'
type ErpFilter = 'all' | 'in' | 'out' | 'stock'
const FAMILIES: BrandFamily[] = ['PSA', 'MG', 'TOYOTA', 'FIAT', 'VOLVO', 'VAG', 'BMW', 'MITSUBISHI']

/** The dashboard code for a number as a brand's part: MG behind its prefix, catalogue-only brands on their own page. */
const erpCode = (code: string, brand: BrandFamily) => (brand === 'MG' ? 'MG' + code.replace(/^MG/, '') : code)
const itemHref = (code: string, brand: BrandFamily) =>
  ERP_FAMILIES.has(brand) ? `/items/${encodeURIComponent(erpCode(code, brand))}` : `/items/${familySlug(brand)}/${encodeURIComponent(code)}`
const bare = (code: string) => code.replace(/^MG/, '')
const nodeLabel = (code: string, brand: BrandFamily) => `${brand}: ${bare(code)}`

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button type="button" size="sm" variant={active ? 'default' : 'outline'} className="h-7 text-xs" onClick={onClick} aria-pressed={active}>{children}</Button>
  )
}

export default function CrossBrandPage() {
  const { locale } = useLocale()
  const isHe = locale === 'he'
  const Arrow = isHe ? ArrowLeft : ArrowRight

  const [kind, setKind] = useState<Kind>('all')
  // one brand filters to everything that touches it; a second one narrows to
  // the relations between exactly those two brands
  const [family, setFamily] = useState<BrandFamily | ''>('')
  const [family2, setFamily2] = useState<BrandFamily | ''>('')
  const pickFamily = (f: BrandFamily | '') => {
    if (f === '') { setFamily(''); setFamily2(''); return }
    if (f === family) { setFamily(family2); setFamily2(''); return }
    if (f === family2) { setFamily2(''); return }
    if (!family) setFamily(f); else setFamily2(f)
  }
  // `detail` is how many codes show at normal zoom; zooming in reveals the rest
  // of the 600 the page loads, busiest first.
  const [detail, setDetail] = useState(100)
  const limit = 600
  const [erp, setErp] = useState<ErpFilter>('all')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => { const t = setTimeout(() => setSearch(q.trim()), 300); return () => clearTimeout(t) }, [q])

  const root = useQuery<RootPayload>({
    queryKey: ['cross-brand', kind, family, family2, search, limit, erp],
    queryFn: async () => {
      const p = new URLSearchParams({ kind, limit: String(limit), erp })
      if (family) p.set('family', family)
      if (family2) p.set('family2', family2)
      if (search) p.set('q', search)
      const res = await fetch(`/api/catalog/cross-brand?${p}`)
      if (!res.ok) throw new Error(String(res.status))
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
  })

  // navigation stack: 'root' or a {code, brand}
  const [stack, setStack] = useState<Array<{ code: string; brand: BrandFamily } | 'root'>>(['root'])
  const view = stack[stack.length - 1]
  const go = useCallback((code: string, brand: BrandFamily) => setStack((s) => [...s, { code, brand }]), [])
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))

  // lineage data for the current part, from the item API the item page already uses
  const lineage = useQuery({
    queryKey: ['cross-brand-lineage', view === 'root' ? null : view.code, view === 'root' ? null : view.brand],
    enabled: view !== 'root',
    queryFn: async () => {
      const v = view as { code: string; brand: BrandFamily }
      const url = ERP_FAMILIES.has(v.brand)
        ? `/api/items/${encodeURIComponent(erpCode(v.code, v.brand))}`
        : `/api/items/${encodeURIComponent(v.code)}?brand=${familySlug(v.brand)}`
      const [item, links] = await Promise.all([
        fetch(url).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/items/${encodeURIComponent(erpCode(v.code, v.brand))}/links`).then((r) => (r.ok ? r.json() : { links: [] })).catch(() => ({ links: [] })),
      ])
      return { item, links: links?.links ?? [] }
    },
    staleTime: 5 * 60 * 1000,
  })

  const graph = useMemo((): { nodes: GNode[]; links: GLink[] } => {
    if (view === 'root') {
      const d = root.data
      if (!d) return { nodes: [], links: [] }
      const nodes: GNode[] = []
      const links: GLink[] = []
      const fams = new Set<string>()
      // rank = how many scanned cars carry the code; the graph reveals nodes in this order on zoom
      for (const c of d.codes) {
        const cars = Object.values(c.fams).reduce((s, n) => s + n, 0)
        nodes.push({ id: c.code, kind: 'code', brand: c.brand, label: nodeLabel(c.code, c.brand), sub: shortName(c.heb), clickable: true, rank: cars })
        for (const [f, n] of Object.entries(c.fams)) { fams.add(f); links.push({ source: c.code, target: 'fam:' + f, kind: 'cars', weight: n }) }
      }
      const seen = new Set(d.codes.map((c) => c.code))
      for (const m of d.matches) {
        for (const [code, brand, heb, cars] of [[m.a, m.aBrand, m.aHeb, m.aCars], [m.b, m.bBrand, m.bHeb, m.bCars]] as const) {
          if (!seen.has(code)) {
            seen.add(code); fams.add(brand)
            nodes.push({ id: code, kind: 'code', brand, label: nodeLabel(code, brand), sub: shortName(heb), clickable: true, rank: cars })
            links.push({ source: code, target: 'fam:' + brand, kind: 'cars', weight: cars })
          }
        }
        links.push({ source: m.a, target: m.b, kind: 'equiv', weight: Math.min(m.aCars, m.bCars) })
      }
      // every brand the catalog holds gets a disc, so the rest of the parts are on the map as a number
      for (const f of Object.keys(d.brandTotals ?? {})) if (f !== 'OTHER') fams.add(f)
      for (const f of fams) {
        const t = d.brandTotals?.[f]
        nodes.push({
          id: 'fam:' + f, kind: 'fam', brand: f, label: f,
          sub: t ? `${t.parts.toLocaleString()} ${isHe ? 'חלקים' : 'parts'} · ${t.cross.toLocaleString()} ${isHe ? 'בין-יצרניים' : 'cross-brand'}` : null,
        })
      }
      return { nodes, links }
    }
    const v = view
    const item = lineage.data?.item
    const nodes: GNode[] = []
    const links: GLink[] = []
    const add = (id: string, brand: BrandFamily, sub?: string | null, extra: Partial<GNode> = {}) => {
      if (nodes.some((n) => n.id === id)) return
      nodes.push({ id, kind: 'code', brand, label: nodeLabel(id, brand), sub: sub ?? null, clickable: id !== v.code, ...extra })
    }
    add(v.code, v.brand, shortName(item?.name), { root: true, href: itemHref(v.code, v.brand), clickable: false })
    // ERP chain (dashed arrows), oldest -> newest
    const erpChain: string[] = (item?.item_id_history ?? []).map((c: unknown) => String(c))
    for (let i = 0; i < erpChain.length; i++) {
      add(erpChain[i], v.brand, item?.name ?? null)
      if (i > 0) links.push({ source: erpChain[i - 1], target: erpChain[i], kind: 'erp' })
    }
    // catalog chain before / after (solid arrows)
    const prev: Array<{ code: string; name: string | null }> = item?.catalog_prev ?? []
    const next: Array<{ code: string; name: string | null }> = item?.catalog_history ?? []
    const anchorFirst = erpChain[0] ?? v.code, anchorLast = erpChain[erpChain.length - 1] ?? v.code
    let tail = anchorFirst
    for (const p of [...prev].reverse()) { add(p.code, v.brand, p.name); links.push({ source: p.code, target: tail, kind: 'chain' }); tail = p.code }
    let head = anchorLast
    for (const n of next) { add(n.code, v.brand, n.name); links.push({ source: head, target: n.code, kind: 'chain' }); head = n.code }
    // equivalents (dotted)
    for (const l of lineage.data?.links ?? []) {
      const b = (l.brand as BrandFamily) || 'PSA'
      add(l.code, b, l.hebrewDescription ?? null)
      links.push({ source: v.code, target: l.code, kind: 'equiv' })
    }
    // brands that print this number (faded satellites)
    for (const o of item?.other_brands ?? []) {
      nodes.push({ id: 'fam:' + o.brand, kind: 'fam', brand: o.brand, label: o.brand, sub: `${o.total} ${isHe ? 'רכבים' : 'cars'}` })
      links.push({ source: v.code, target: 'fam:' + o.brand, kind: 'cars', weight: o.total })
    }
    const fits = item?.fits?.length ?? 0
    if (fits) {
      nodes.push({ id: 'fam:' + v.brand, kind: 'fam', brand: v.brand, label: v.brand, sub: `${fits}${item?.fits_truncated ? '+' : ''} ${isHe ? 'רכבים' : 'cars'}` })
      links.push({ source: v.code, target: 'fam:' + v.brand, kind: 'cars', weight: fits })
    }
    return { nodes, links }
  }, [view, root.data, lineage.data, isHe])

  const onNodeClick = useCallback((n: GNode) => { if (n.kind === 'code') go(n.id, n.brand as BrandFamily) }, [go])

  return (
    <div className="space-y-4">
      <PageHeader
        icon={Shuffle}
        title={isHe ? 'קשרים בין יצרנים' : 'Cross-brand relations'}
        description={isHe
          ? 'מק״טים שמופיעים אצל יותר מיצרן אחד, וחלקים מקבילים תחת מספרים שונים. לחיצה על מק״ט פותחת את השרשרת שלו.'
          : 'Item numbers printed by more than one brand, and matched parts under different numbers. Click a code to open its lineage.'}
      />

      {view === 'root' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Chip active={kind === 'all'} onClick={() => setKind('all')}>{isHe ? 'הכל' : 'All'}</Chip>
          <Chip active={kind === 'collisions'} onClick={() => setKind('collisions')}>{isHe ? 'אותו מספר, חלק אחר' : 'Same number, different part'}</Chip>
          <Chip active={kind === 'shared'} onClick={() => setKind('shared')}>{isHe ? 'מספור משותף' : 'Shared numbering'}</Chip>
          <Chip active={kind === 'matches'} onClick={() => setKind('matches')}>{isHe ? 'חלקים מקבילים' : 'Matched parts'}</Chip>
          <span className="mx-1 text-muted-foreground">·</span>
          <Chip active={family === ''} onClick={() => pickFamily('')}>{isHe ? 'כל היצרנים' : 'All brands'}</Chip>
          {FAMILIES.map((f) => <Chip key={f} active={family === f || family2 === f} onClick={() => pickFamily(f)}>{isHe ? FAMILY_LABEL_HE[f] : f}</Chip>)}
          {family && !family2 && <span className="text-xs text-muted-foreground">{isHe ? 'בחרו יצרן שני כדי לראות רק את הקשרים בין השניים' : 'pick a second brand to see only the relations between the two'}</span>}
          {family && family2 && <Badge variant="outline" className="font-mono">{family} ↔ {family2}</Badge>}
          <span className="mx-1 text-muted-foreground">·</span>
          <Chip active={erp === 'all'} onClick={() => setErp('all')}>{isHe ? 'עם ובלי ERP' : 'ERP: any'}</Chip>
          <Chip active={erp === 'in'} onClick={() => setErp('in')}>{isHe ? 'קיים ב-ERP' : 'Exists in ERP'}</Chip>
          <Chip active={erp === 'out'} onClick={() => setErp('out')}>{isHe ? 'לא ב-ERP' : 'Not in ERP'}</Chip>
          <Chip active={erp === 'stock'} onClick={() => setErp('stock')}>{isHe ? 'במלאי' : 'In stock'}</Chip>
          <div className="relative ms-auto w-full sm:w-56">
            <Search className="absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="cross-brand-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                // Enter on a code opens it, cross-brand or not: the lineage view
                // works for any part the item API knows.
                if (e.key !== 'Enter') return
                const code = q.trim().toUpperCase()
                if (/^[A-Z0-9-]{4,}$/.test(code)) { e.preventDefault(); go(code, guessBrand(code)) }
              }}
              placeholder={isHe ? 'מק״ט או שם · Enter פותח כל מק״ט' : 'code or name · Enter opens any code'}
              className="h-8 ps-7 text-sm"
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <button type="button" className="text-primary hover:underline" onClick={() => setStack(['root'])}>{isHe ? 'שורש' : 'Root'}</button>
          {stack.slice(1).map((s, i) => s !== 'root' && (
            <span key={i} className="flex items-center gap-3">
              <span className="text-muted-foreground">›</span>
              {i === stack.length - 2 ? (
                <a href={itemHref(s.code, s.brand)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono font-medium text-primary hover:underline">
                  {nodeLabel(s.code, s.brand)} <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <button type="button" className="font-mono hover:underline" onClick={() => setStack(stack.slice(0, i + 2))}>{nodeLabel(s.code, s.brand)}</button>
              )}
            </span>
          ))}
          {lineage.data?.item?.name && <span className="text-muted-foreground" dir="auto">{lineage.data.item.name}</span>}
          <Button type="button" size="sm" variant="outline" className="ms-auto h-7 text-xs" onClick={back}>
            <Arrow className="me-1 h-3 w-3 rotate-180" />{isHe ? 'חזרה' : 'Back'}
          </Button>
        </div>
      )}

      {(view === 'root' ? root.isLoading : lineage.isLoading) ? (
        <div className="h-[720px] animate-pulse rounded-md bg-muted/40" />
      ) : (
        <CrossBrandGraph nodes={graph.nodes} links={graph.links} onNodeClick={onNodeClick} mode={view === 'root' ? 'root' : 'lineage'} detail={view === 'root' ? detail : undefined} />
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {FAMILIES.slice(0, 5).map((f) => <FamilyChip key={f} family={f} />)}
        {view === 'root' ? (
          <>
            <span>{isHe ? 'קו מלא ליצרן: היצרן מדפיס את המספר, עובי = רכבים סרוקים' : 'solid to a brand: that brand prints the number, width = scanned cars'}</span>
            <span>{isHe ? 'מקווקו בין מק״טים: אותו חלק, מספר אחר' : 'dotted between codes: same part, different number'}</span>
          </>
        ) : (
          <>
            <span>{isHe ? 'חץ מלא: החלפה בקטלוג' : 'solid arrow: catalog supersession'}</span>
            <span>{isHe ? 'חץ מקווקו: שרשרת ERP' : 'dashed arrow: ERP chain'}</span>
            <span>{isHe ? 'מנוקד: אותו חלק אצל יצרן אחר' : 'dotted: same part, other brand'}</span>
            <span>{isHe ? 'הכותרת של המק״ט פותחת את דף הפריט' : 'the code’s title opens its item page'}</span>
          </>
        )}
      </div>

      {view === 'root' && root.data && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <Badge variant="secondary">{root.data.totals.codes}</Badge>
          <span>{isHe ? 'מק״טים אצל יותר מיצרן אחד' : 'codes under more than one brand'}</span>
          <Badge variant="secondary">{root.data.totals.matches}</Badge>
          <span>{isHe ? 'זוגות מקבילים' : 'matched pairs'}</span>
          <Badge variant="secondary">{root.data.totals.unique_codes}</Badge>
          <span>{isHe ? 'מק״טים ייחודיים בסך הכל' : 'unique codes in total'}</span>
          <Badge variant="secondary">{root.data.totals.in_erp}</Badge>
          <span>{isHe ? 'קיימים ב-ERP' : 'exist in the ERP'}</span>
          <Badge variant="secondary">{root.data.totals.in_stock}</Badge>
          <span>{isHe ? 'במלאי' : 'in stock'}</span>
          <span className="mx-1">·</span>
          <span>{isHe ? 'בזום רגיל' : 'at normal zoom'}</span>
          {[50, 100, 300].map((n) => (
            <Chip key={n} active={detail === n} onClick={() => setDetail(n)}>{n}</Chip>
          ))}
          <span>{isHe ? `· ${Math.min(limit, root.data.codes.length + root.data.matches.length * 2)} טעונים; זום פנימה חושף את השאר, העמוסים קודם` : `· ${Math.min(limit, root.data.codes.length + root.data.matches.length * 2)} loaded; zoom in to reveal the rest, busiest first`}</span>
          {root.data.truncated && <span>{isHe ? '· סננו לפי יצרן או חפשו כדי להגיע מעבר לכך' : '· filter by brand or search to reach beyond that'}</span>}
        </div>
      )}
      {view !== 'root' && lineage.data && !lineage.data.item && (
        <p className="text-sm text-muted-foreground">{isHe ? 'לא נמצא מידע על המק״ט הזה.' : 'Nothing is known about this code.'}</p>
      )}
      {view !== 'root' && lineage.data?.item && (() => {
        const codeNodes = graph.nodes.filter((n) => n.kind === 'code')
        const chain = codeNodes.filter((n) => n.brand === view.brand).length
        const uniq = new Set(codeNodes.map((n) => bare(n.id))).size
        const equiv = graph.links.filter((l) => l.kind === 'equiv').length
        const brands = graph.nodes.filter((n) => n.kind === 'fam').length
        return (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <Badge variant="secondary">{codeNodes.length}</Badge>
            <span>{isHe ? 'מק״טים בגרף' : 'codes in the graph'}</span>
            <Badge variant="secondary">{chain}</Badge>
            <span>{isHe ? 'בשרשרת של היצרן הזה (ERP + קטלוג)' : 'in this brand’s chain (ERP + catalog)'}</span>
            <Badge variant="secondary">{uniq}</Badge>
            <span>{isHe ? 'ייחודיים' : 'unique'}</span>
            <Badge variant="secondary">{equiv}</Badge>
            <span>{isHe ? 'מקבילים אצל יצרנים אחרים' : 'equivalents in other brands'}</span>
            <Badge variant="secondary">{brands}</Badge>
            <span>{isHe ? 'יצרנים שמדפיסים את המספר' : 'brands printing the number'}</span>
          </div>
        )
      })()}
    </div>
  )
}
