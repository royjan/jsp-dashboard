import { NextResponse } from 'next/server'
import { initializeSecrets } from '@/lib/aws-secrets'
import { loadCrossBrand, type MatchRel } from '@/lib/cross-brand'

/**
 * GET /api/catalog/cross-brand — the cross-brand graph, filtered.
 *
 * The data comes from Redis (see lib/cross-brand.ts: computed nightly, kept
 * 36 h, computed on demand on a miss); this route only filters and budgets it.
 *
 * Query params: kind=all|collisions|shared|matches, family=<BrandFamily>,
 * family2=<BrandFamily> (relations between exactly those two brands),
 * erp=all|in|out|stock, q=<code or name substring>,
 * limit=<nodes, default 100, max 1000>, fresh=1 to recompute now.
 */
export async function GET(req: Request) {
  try {
    await initializeSecrets()
    const { searchParams } = new URL(req.url)
    const kind = searchParams.get('kind') || 'all'
    const family = (searchParams.get('family') || '').toUpperCase()
    // a second family narrows to the relations BETWEEN the two brands only
    const family2 = (searchParams.get('family2') || '').toUpperCase()
    // erp=in: the ERP has the item; erp=out: it does not; erp=stock: on the shelf now
    const erpFilter = searchParams.get('erp') || 'all'
    const q = (searchParams.get('q') || '').trim().toUpperCase()
    const limit = Math.min(1000, Math.max(20, parseInt(searchParams.get('limit') || '100', 10) || 100))
    const fresh = searchParams.get('fresh') === '1'

    const data = await loadCrossBrand(fresh)

    const hit = (code: string, heb: string | null) =>
      !q || code.toUpperCase().includes(q) || (heb ?? '').toUpperCase().includes(q)

    let codes = data.codes
    if (kind === 'collisions') codes = codes.filter((c) => !c.shared_numbering)
    else if (kind === 'shared') codes = codes.filter((c) => c.shared_numbering)
    else if (kind === 'matches') codes = []
    if (family) codes = codes.filter((c) => family in c.fams)
    if (family2) codes = codes.filter((c) => family2 in c.fams)
    if (erpFilter === 'in') codes = codes.filter((c) => c.in_erp)
    else if (erpFilter === 'out') codes = codes.filter((c) => !c.in_erp)
    else if (erpFilter === 'stock') codes = codes.filter((c) => c.stock > 0)
    if (q) codes = codes.filter((c) => hit(c.code, c.heb))
    // the busiest numbers first, so a cap keeps what is most worth seeing
    codes = [...codes].sort((x, y) =>
      Object.values(y.fams).reduce((s, n) => s + n, 0) - Object.values(x.fams).reduce((s, n) => s + n, 0))

    let matches = data.matches
    if (kind === 'collisions' || kind === 'shared') matches = []
    if (family) matches = matches.filter((m) => m.aBrand === family || m.bBrand === family)
    if (family2) matches = matches.filter((m) => (m.aBrand === family && m.bBrand === family2) || (m.aBrand === family2 && m.bBrand === family))
    // a matched pair "exists in the ERP" when either side does — that is the point of a match
    if (erpFilter === 'in') matches = matches.filter((m) => m.aInErp || m.bInErp)
    else if (erpFilter === 'out') matches = matches.filter((m) => !m.aInErp && !m.bInErp)
    else if (erpFilter === 'stock') matches = matches.filter((m) => m.aStock > 0 || m.bStock > 0)
    if (q) matches = matches.filter((m) => hit(m.a, m.aHeb) || hit(m.b, m.bHeb))

    const uniqueCodes = new Set<string>()
    for (const c of codes) uniqueCodes.add(c.code)
    for (const m of matches) { uniqueCodes.add(m.a); uniqueCodes.add(m.b) }
    const totals = {
      codes: codes.length,
      matches: matches.length,
      unique_codes: uniqueCodes.size,
      in_erp: codes.filter((c) => c.in_erp).length + matches.filter((m) => m.aInErp || m.bInErp).length,
      in_stock: codes.filter((c) => c.stock > 0).length + matches.filter((m) => m.aStock > 0 || m.bStock > 0).length,
    }

    // One node budget for the whole graph, shared half and half: matched pairs
    // (two nodes each) and same-number codes, so a brand that only appears
    // through matches — Toyota, 3,895 pairs — is never crowded out. Within
    // each half the busiest first: the codes on the most scanned cars are the
    // ones worth a look, and they are what the page reveals first on zoom.
    const rankedMatches: MatchRel[] = [...matches].sort((x, y) => (y.aCars + y.bCars) - (x.aCars + x.bCars) || Number(y.aInErp || y.bInErp) - Number(x.aInErp || x.bInErp))
    let pairBudget = Math.min(rankedMatches.length, Math.floor(limit / 4))
    const codeBudget = Math.min(codes.length, limit - pairBudget * 2)
    if (codeBudget < limit - pairBudget * 2) pairBudget = Math.min(rankedMatches.length, Math.floor((limit - codeBudget) / 2))
    const matchesOut = rankedMatches.slice(0, pairBudget)
    const codesOut = codes.slice(0, codeBudget)

    return NextResponse.json({
      codes: codesOut, matches: matchesOut, totals, brandTotals: data.brandTotals ?? {},
      truncated: codesOut.length < codes.length || matchesOut.length < matches.length,
      computedAt: data.computedAt,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'cross-brand failed' },
      { status: 500 },
    )
  }
}
