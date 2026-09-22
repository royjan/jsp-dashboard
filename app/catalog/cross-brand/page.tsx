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

interface CodeRel { code: string; brand: BrandFamily; heb: string | null; fams: Record<string, number>; shared_numbering: boolean }
interface MatchRel { a: string; aBrand: BrandFamily; aHeb: string | null; b: string; bBrand: BrandFamily; bHeb: string | null; source: string }
interface RootPayload { codes: CodeRel[]; matches: MatchRel[]; totals: { codes: number; matches: number }; truncated: boolean; computedAt: string }

type Kind = 'all' | 'collisions' | 'shared' | 'matches'
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
  const [family, setFamily] = useState<BrandFamily | ''>('')
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => { const t = setTimeout(() => setSearch(q.trim()), 300); return () => clearTimeout(t) }, [q])

  const root = useQuery<RootPayload>({
    queryKey: ['cross-brand', kind, family, search],
    queryFn: async () => {
      const p = new URLSearchParams({ kind, limit: '200' })
      if (family) p.set('family', family)
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
      for (const c of d.codes) {
        nodes.push({ id: c.code, kind: 'code', brand: c.brand, label: nodeLabel(c.code, c.brand), sub: c.heb, clickable: true })
        for (const [f, n] of Object.entries(c.fams)) { fams.add(f); links.push({ source: c.code, target: 'fam:' + f, kind: 'cars', weight: n }) }
      }
      const seen = new Set(d.codes.map((c) => c.code))
      for (const m of d.matches) {
        for (const [code, brand, heb] of [[m.a, m.aBrand, m.aHeb], [m.b, m.bBrand, m.bHeb]] as const) {
          if (!seen.has(code)) {
            seen.add(code); fams.add(brand)
            nodes.push({ id: code, kind: 'code', brand, label: nodeLabel(code, brand), sub: heb, clickable: true })
            links.push({ source: code, target: 'fam:' + brand, kind: 'cars', weight: 0 })
          }
        }
        links.push({ source: m.a, target: m.b, kind: 'equiv' })
      }
      for (const f of fams) nodes.push({ id: 'fam:' + f, kind: 'fam', brand: f, label: f })
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
    add(v.code, v.brand, item?.name ?? null, { root: true, href: itemHref(v.code, v.brand), clickable: false })
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
          <Chip active={family === ''} onClick={() => setFamily('')}>{isHe ? 'כל היצרנים' : 'All brands'}</Chip>
          {FAMILIES.map((f) => <Chip key={f} active={family === f} onClick={() => setFamily(f)}>{isHe ? FAMILY_LABEL_HE[f] : f}</Chip>)}
          <div className="relative ms-auto w-full sm:w-56">
            <Search className="absolute start-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input id="cross-brand-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={isHe ? 'מק״ט או שם' : 'code or name'} className="h-8 ps-7 text-sm" />
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
        <div className="h-[560px] animate-pulse rounded-md bg-muted/40" />
      ) : (
        <CrossBrandGraph nodes={graph.nodes} links={graph.links} onNodeClick={onNodeClick} />
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
        <p className="text-sm text-muted-foreground">
          <Badge variant="secondary" className="me-2">{root.data.totals.codes}</Badge>
          {isHe ? 'מק״טים אצל יותר מיצרן אחד' : 'codes under more than one brand'}
          <Badge variant="secondary" className="mx-2">{root.data.totals.matches}</Badge>
          {isHe ? 'זוגות מקבילים' : 'matched pairs'}
          {root.data.truncated && (isHe ? ' · מוצגים הראשונים, סננו לפי יצרן או חפשו כדי לראות את השאר' : ' · showing the busiest first, filter by brand or search to reach the rest')}
        </p>
      )}
      {view !== 'root' && lineage.data && !lineage.data.item && (
        <p className="text-sm text-muted-foreground">{isHe ? 'לא נמצא מידע על המק״ט הזה.' : 'Nothing is known about this code.'}</p>
      )}
    </div>
  )
}
