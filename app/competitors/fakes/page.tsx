'use client'

/**
 * Counterfeit suspects — competitor "originals" priced at or under our cost.
 *
 * The rule comes from the portal (`server/lib/fakeScan.mjs`), which owns the
 * customer-facing consequence: an admin verdict there raises the "היזהרו
 * מזיופים" stamp on the part. This screen does not write that verdict. It
 * answers the buyer's question instead — which of these is worth chasing —
 * and it says out loud when the reason a competitor looks impossibly cheap is
 * that OUR cost is two years old.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, HelpCircle, RefreshCw, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { ItemLink } from '@/components/shared/ItemLink'
import { PageHeader } from '@/components/shared/PageHeader'
import { StatTile } from '@/components/shared/StatTile'
import { PastePriceCheck } from '@/components/competitors/PastePriceCheck'
import { useFakeCandidates, useLiveCosts } from '@/hooks/use-fakes'
import { formatCurrency, formatNumber } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import {
  classifySuspect, costAgeDays, DEFAULT_THRESHOLD_PCT, overCostPct,
  STALE_COST_DAYS, type SuspectVerdict,
} from '@/lib/fake-scan'
import type { FakeCandidateRow } from '@/app/api/competitors/fakes/route'

interface ScannedRow extends FakeCandidateRow {
  verdict: SuspectVerdict
  /** The cost actually used — the cached one, or a live one someone fetched. */
  effectiveCost: number
  /** True when `effectiveCost` came from FINAPI in this session. */
  liveCost: boolean
  costAge: number | null
  overCost: number | null
}

const VERDICT_LABEL: Record<SuspectVerdict, string> = {
  suspect: 'חשד',
  stale_cost: 'עלות ישנה',
  confirmed: 'זיוף מאושר',
  cleared: 'נבדק ואושר',
  none: 'תקין',
}

const VERDICT_VARIANT: Record<SuspectVerdict, 'destructive' | 'warning' | 'success' | 'secondary'> = {
  suspect: 'destructive',
  stale_cost: 'warning',
  confirmed: 'destructive',
  cleared: 'success',
  none: 'secondary',
}

const COLUMNS: DataTableColumn<ScannedRow>[] = [
  {
    key: 'verdict',
    header: 'מצב',
    sortable: true,
    cell: r => <Badge variant={VERDICT_VARIANT[r.verdict]}>{VERDICT_LABEL[r.verdict]}</Badge>,
    exportValue: r => VERDICT_LABEL[r.verdict],
  },
  {
    key: 'itemCode',
    header: 'מק"ט',
    sortable: true,
    cell: r => <ItemLink code={r.itemCode} showCode />,
    exportValue: r => r.itemCode,
    cellClassName: 'font-mono text-xs',
  },
  {
    key: 'erpName',
    header: 'שם',
    sortable: true,
    truncate: 'max-w-[240px]',
    title: r => r.erpName ?? r.competitorName ?? '',
    // The competitor's own description is often the only Hebrew name we hold —
    // 573 of the costed rows have no ERP name mirrored in the portal.
    cell: r => (
      <span dir="rtl">
        {r.erpName ?? r.competitorName ?? '—'}
        {!r.erpName && r.competitorName && (
          <span className="text-muted-foreground text-xs"> (לפי המתחרה)</span>
        )}
      </span>
    ),
    exportValue: r => r.erpName ?? r.competitorName ?? '',
  },
  {
    key: 'competitor',
    header: 'מתחרה',
    sortable: true,
    cell: r => r.competitor,
    exportValue: r => r.competitor,
  },
  {
    key: 'netPrice',
    header: 'המחיר שלהם',
    align: 'end',
    sortable: true,
    cell: r => (
      <span className="whitespace-nowrap">
        {formatCurrency(r.netPrice, 2)}
        {r.grossPrice && r.grossPrice > r.netPrice && (
          <span className="text-muted-foreground text-xs"> מ-{formatCurrency(r.grossPrice, 0)}</span>
        )}
      </span>
    ),
    exportValue: r => r.netPrice,
  },
  {
    key: 'effectiveCost',
    header: 'העלות שלנו',
    align: 'end',
    sortable: true,
    cell: r => (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        {formatCurrency(r.effectiveCost, 2)}
        {r.liveCost ? (
          <Badge variant="success" className="text-[10px]">עדכני</Badge>
        ) : (
          r.costAge !== null && r.costAge > STALE_COST_DAYS && (
            <Badge variant="warning" className="text-[10px]">
              {Math.floor(r.costAge / 365)} שנים
            </Badge>
          )
        )}
      </span>
    ),
    exportValue: r => r.effectiveCost,
  },
  {
    key: 'overCost',
    header: 'מול העלות',
    align: 'end',
    sortable: true,
    cell: r =>
      r.overCost === null ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        <span className={r.overCost < 0 ? 'font-medium text-destructive' : undefined}>
          {r.overCost > 0 ? '+' : ''}
          {r.overCost.toFixed(0)}%
        </span>
      ),
    exportValue: r => r.overCost,
  },
  {
    key: 'listPrice',
    header: 'המחירון שלנו',
    align: 'end',
    sortable: true,
    cell: r => (r.listPrice ? formatCurrency(r.listPrice, 0) : <span className="text-muted-foreground">—</span>),
    exportValue: r => r.listPrice ?? null,
  },
  {
    key: 'inStock',
    header: 'מלאי',
    align: 'end',
    sortable: true,
    // null is "the portal has no mirror for this code", not "none in stock".
    cell: r =>
      r.inStock === null ? <span className="text-muted-foreground">?</span> : formatNumber(r.inStock),
    exportValue: r => r.inStock,
  },
  {
    key: 'soldThisYear',
    header: 'נמכר השנה',
    align: 'end',
    sortable: true,
    cell: r =>
      r.soldThisYear === null ? <span className="text-muted-foreground">?</span> : formatNumber(r.soldThisYear),
    exportValue: r => r.soldThisYear,
  },
]

export default function FakesPage() {
  // formatCurrency() masks from a module store; without this the amounts here
  // would not re-render when the money-hidden eye is toggled.
  useMoneyHidden()

  const { data, isLoading, error, refetch } = useFakeCandidates()
  const live = useLiveCosts()
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD_PCT)
  const [showAll, setShowAll] = useState(false)

  /** Live costs fetched in this session, keyed by upper-case code. */
  const [liveCosts, setLiveCosts] = useState<Record<string, number>>({})

  const scanned: ScannedRow[] = useMemo(() => {
    const now = new Date()
    return (data?.rows ?? []).map(r => {
      const fresh = liveCosts[r.itemCode.toUpperCase()]
      const effectiveCost = fresh ?? r.cost
      // A cost read from the ERP a moment ago is dated now — that is the whole
      // point of fetching it, and it is what lets a stale_cost row resolve.
      const costDate = fresh ? now.toISOString() : r.costDate
      return {
        ...r,
        effectiveCost,
        liveCost: fresh !== undefined,
        costAge: costAgeDays(costDate, now),
        overCost: overCostPct(r.netPrice, effectiveCost),
        verdict: classifySuspect(
          { competitorPrice: r.netPrice, cost: effectiveCost, costDate, fakeStatus: r.fakeStatus },
          threshold,
          now,
        ),
      }
    })
  }, [data?.rows, liveCosts, threshold])

  const counts = useMemo(() => {
    const c = { suspect: 0, stale_cost: 0, confirmed: 0, cleared: 0, none: 0 }
    for (const r of scanned) c[r.verdict] += 1
    return c
  }, [scanned])

  const rows = useMemo(
    () => (showAll ? scanned : scanned.filter(r => r.verdict !== 'none')),
    [scanned, showAll],
  )

  const staleCodes = useMemo(
    () => [...new Set(scanned.filter(r => r.verdict === 'stale_cost').map(r => r.itemCode.toUpperCase()))],
    [scanned],
  )

  const recost = async () => {
    if (!staleCodes.length) return
    const res = await live.mutateAsync(staleCodes).catch(() => null)
    if (res) setLiveCosts(prev => ({ ...prev, ...res.costs }))
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="חשד לזיופים"
        description="מתחרים שמוכרים חלק מקורי במחיר שנמוך מהעלות שלנו"
        icon={ShieldAlert}
        provenance={
          data
            ? {
                source: 'snapshot',
                asOf: data.counts.lastUploadAt ?? undefined,
                rows: data.counts.costedRows,
                scope: 'שורות מתחרים מקוריות שיש לנו עבורן עלות',
              }
            : null
        }
        actions={
          staleCodes.length > 0 ? (
            <Button variant="outline" size="sm" onClick={recost} disabled={live.isPending} className="gap-2">
              <RefreshCw className={live.isPending ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              בדוק עלות עדכנית ({staleCodes.length})
            </Button>
          ) : undefined
        }
      />

      <Explainer threshold={threshold} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="חשד ממשי"
          value={formatNumber(counts.suspect + counts.confirmed)}
          icon={AlertTriangle}
          tone={counts.suspect + counts.confirmed > 0 ? 'bad' : 'good'}
          higherIsBetter={false}
          hint="מחיר מתחת לעלות, על עלות עדכנית"
          loading={isLoading}
          index={0}
        />
        <StatTile
          label="עלות ישנה מדי"
          value={formatNumber(counts.stale_cost)}
          icon={CalendarClock}
          tone="warn"
          higherIsBetter={false}
          hint="העלות מעל שנה וחצי — לא ניתן להכריע"
          loading={isLoading}
          index={1}
        />
        <StatTile
          label="נבדקו"
          value={formatNumber(data?.counts.costedRows ?? 0)}
          hint="שורות מתחרים מקוריות עם עלות"
          loading={isLoading}
          index={2}
        />
        <StatTile
          label="ללא בסיס להשוואה"
          value={formatNumber(data?.counts.noCostBasis ?? 0)}
          icon={HelpCircle}
          tone="info"
          hint="קודים אצל מתחרים שאין לנו עלות עבורם"
          loading={isLoading}
          index={3}
        />
      </div>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex items-center gap-3 text-sm">
              <span className="whitespace-nowrap">
                סף: עד <span className="font-medium tabular-nums">{threshold}%</span> מעל העלות
              </span>
              <input
                type="range"
                min={0}
                max={50}
                step={1}
                value={threshold}
                onChange={e => setThreshold(Number(e.target.value))}
                className="w-40 accent-primary"
                aria-label="סף אחוז מעל העלות"
              />
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showAll}
                onChange={e => setShowAll(e.target.checked)}
                className="accent-primary"
              />
              הצג גם שורות תקינות בטווח הבדיקה
            </label>

            {live.error && <span className="text-xs text-destructive">{live.error.message}</span>}
            {live.data && (
              <span className="text-xs text-muted-foreground">
                עודכנו {Object.keys(live.data.costs).length} עלויות
                {live.data.missing.length > 0 && ` · ${live.data.missing.length} ללא עלות ב-FINAPI`}
              </span>
            )}
          </div>

          <DataTable
            columns={COLUMNS}
            rows={rows}
            getRowKey={r => `${r.itemCode}|${r.competitor}`}
            loading={isLoading}
            error={error}
            onRetry={() => refetch()}
            defaultSort={{ field: 'overCost', dir: 'asc' }}
            minWidth="min-w-[1000px]"
            exportFileName="counterfeit-suspects"
            pageSize={25}
          />
        </CardContent>
      </Card>

      <PastePriceCheck />
    </div>
  )
}

/** The page makes an accusation, so it explains what it is claiming. */
function Explainer({ threshold }: { threshold: number }) {
  return (
    <Card>
      <CardContent className="p-4 text-sm leading-relaxed text-muted-foreground sm:p-6">
        <p>
          מתחרה שמוכר חלק <span className="font-medium text-foreground">מקורי</span> במחיר שאינו גבוה
          ביותר מ-{threshold}% מהעלות שלנו — לא מוכר את אותו החלק. זה הכלל שרץ בפורטל
          (המקרה שהתחיל אותו: 1920RW בעלות ₪346 מול ₪390 אצל המתחרה).
        </p>
        <p className="mt-2">
          ההבדל כאן: העלות נבדקת מול <span className="font-medium text-foreground">התאריך שלה</span>.
          עלות משנת 2024 מול מחיר של 2026 משווה שתי שנים שונות, ולכן שורה כזאת מסומנת
          &quot;עלות ישנה&quot; ולא &quot;חשד&quot; — אפשר להכריע אותה בלחיצה על &quot;בדוק עלות
          עדכנית&quot;, שקוראת את העלות הנוכחית מ-FINAPI.
        </p>
        <p className="mt-2 text-xs">
          מקורות: מחירי המתחרים מהעלאת הגיליון האחרונה בדשבורד · העלויות מהמטמון של הפורטל ·
          הכרעות אדמין קיימות נקראות מהפורטל ואינן נכתבות מכאן.
        </p>
      </CardContent>
    </Card>
  )
}
