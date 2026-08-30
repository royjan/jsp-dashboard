'use client'

import { useMemo, useState } from 'react'
import { Car, Zap, Activity, Check, X, Pencil, Copy } from 'lucide-react'
import type { FlowDecisionRecord, FlowDecisionStatus } from '@/types/chat-admin/flow-decision'
import { toast } from '@/lib/toast'
import { copyText } from '@/lib/clipboard'
import { FLOW_STATUS_PILL } from '@/components/chat-admin/shared/colors'
import { compactCount, relTime } from '@/lib/chat-admin/format'
import { DataTable, type DataTableColumn } from '@/components/shared/DataTable'
import { he } from './labels'

type SortKey = 'partDescription' | 'lambdaTarget' | 'status' | 'updatedAt' | 'category' | 'feedbackCount'
const PAGE_SIZES = [25, 50, 100, 200]

interface Props {
  rules: FlowDecisionRecord[]
  loading: boolean
  selectedIds: string[]
  onSelectionChange: (ids: string[]) => void
  onRowClick: (id: string) => void
  onSetStatus?: (id: string, status: FlowDecisionStatus) => void
  activeId?: string | null
}

function buildColumns(
  onRowClick: (id: string) => void,
  onSetStatus: ((id: string, status: FlowDecisionStatus) => void) | undefined,
): DataTableColumn<FlowDecisionRecord, SortKey>[] {
  return [
    {
      key: 'status',
      header: 'סטטוס',
      sortable: true,
      sortKey: 'status',
      headerClassName: 'w-28',
      cell: r => <StatusPill status={r.status} />,
      exportValue: r => r.status,
    },
    {
      key: 'partDescription',
      header: 'תיאור החלק',
      sortable: true,
      sortKey: 'partDescription',
      headerClassName: 'w-[20%]',
      title: r => r.partDescription,
      cell: r => (
        // `dir="auto"` alone made this column ragged: it resolves an English description to LTR,
        // and inside an RTL table `start` is then the LEFT edge — so English rows sat flush left
        // while Hebrew rows sat flush right, and the two languages drifted apart mid-column.
        // The direction still has to be per-string (the shaping and the bidi run depend on it),
        // so the fix is to keep dir="auto" for the TEXT and pin the BLOCK to the column's own
        // edge, which in an RTL table is the right one. Every row starts in the same place.
        <div className="text-sm text-right">
          <div className="truncate font-medium" dir="auto" title={r.partDescription}>
            {r.partDescription}
          </div>
          {/* click to copy the flow-decision id — a hex id is never bidi, so it is pinned LTR
              and reads `f16c4da4…` rather than having the ellipsis flipped to its front. */}
          <button
            onClick={e => {
              e.stopPropagation()
              copyText(r.id).then(ok => (ok ? toast.success(L.idCopied) : toast.error(L.copyFailed)))
            }}
            title={`${L.copyId}: ${r.id}`}
            dir="ltr"
            className="mt-0.5 inline-flex max-w-full items-center gap-1 font-mono text-[10px] text-muted-foreground transition-colors hover:text-sky-400"
          >
            <Copy className="h-3 w-3 shrink-0" /> {r.id.slice(0, 8)}…
          </button>
        </div>
      ),
      exportValue: r => r.partDescription,
    },
    {
      key: 'lambdaTarget',
      header: 'פורטל',
      sortable: true,
      sortKey: 'lambdaTarget',
      headerClassName: 'w-24',
      cell: r => (
        <span className="inline-block max-w-full truncate rounded bg-muted px-2 py-0.5 font-mono text-xs ring-1 ring-inset ring-border">
          {r.lambdaTarget}
        </span>
      ),
      exportValue: r => r.lambdaTarget,
    },
    {
      key: 'category',
      header: 'קטגוריה / שרטוט',
      sortable: true,
      sortKey: 'category',
      headerClassName: 'w-[22%]',
      title: r => `${r.category} › ${r.subcategory} › ${r.schema}`,
      cell: r => (
        <div className="text-sm">
          {/* dir="auto" per STRING, not per table. These cells hold three scripts at once:
              PSA routes are English, MG's are Chinese (动力总成 › 点火组件), and operators type
              Hebrew. One direction for the column would put one of them against the wrong
              edge — which is what the LTR override used to do to every Hebrew description. */}
          <div className="truncate font-mono text-xs" dir="auto">{r.category} › {r.subcategory}</div>
          <div className="truncate font-mono text-xs text-muted-foreground" dir="auto">{r.schema}</div>
        </div>
      ),
      exportValue: r => `${r.category} › ${r.subcategory} › ${r.schema}`,
    },
    {
      key: 'vehicle',
      header: 'רכב',
      headerClassName: 'w-[14%]',
      hideOnMobile: true,
      cell: r => {
        const summary = describeVehicle(r)
        return summary ? (
          <span
            title={summary}
            className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs ring-1 ring-inset ring-border"
          >
            <Car className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{summary}</span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">any</span>
        )
      },
      exportValue: r => describeVehicle(r) ?? 'כל הרכבים',
    },
    {
      key: 'feedbackCount',
      header: <span title="אותות משוב שהתקבלו · רמת ביטחון. גבוה יותר = אמין יותר.">פעילות</span>,
      exportHeader: 'Feedback',
      sortable: true,
      sortKey: 'feedbackCount',
      headerClassName: 'w-24',
      cell: r => <TrustSignal rule={r} />,
      exportValue: r => r.feedbackCount ?? 0,
    },
    {
      key: 'direct',
      header: 'ישיר',
      align: 'center',
      headerClassName: 'w-14',
      hideOnMobile: true,
      cell: r =>
        hasDirectPart(r) ? (
          <Zap aria-label={'יש מק"ט ישיר'} className="mx-auto h-4 w-4 fill-emerald-400 text-emerald-400" />
        ) : (
          <span className="sr-only">אין מק"ט ישיר</span>
        ),
      exportValue: r => (hasDirectPart(r) ? 'כן' : 'לא'),
    },
    {
      key: 'updatedAt',
      header: 'עודכן',
      sortable: true,
      sortKey: 'updatedAt',
      headerClassName: 'w-24',
      cell: r => <span className="text-xs text-muted-foreground">{relTime(r.updatedAt)}</span>,
      // The raw timestamp, not "3 days ago" — the relative string sorts wrong
      // and is useless in a spreadsheet.
      exportValue: r => String(r.updatedAt ?? ''),
    },
    {
      key: 'actions',
      header: 'פעולות',
      align: 'end',
      headerClassName: 'w-24',
      cell: r => (
        // inline quick actions — appear on row hover, no need to open the editor
        <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {onSetStatus && r.status !== 'approved' && (
            <RowAction title="אשר" tone="hover:bg-emerald-500/20 hover:text-emerald-400"
              onClick={e => { e.stopPropagation(); onSetStatus(r.id, 'approved') }}><Check className="h-3.5 w-3.5" /></RowAction>
          )}
          {onSetStatus && r.status !== 'rejected' && (
            <RowAction title="דחה" tone="hover:bg-rose-500/20 hover:text-rose-400"
              onClick={e => { e.stopPropagation(); onSetStatus(r.id, 'rejected') }}><X className="h-3.5 w-3.5" /></RowAction>
          )}
          <RowAction title="ערוך" tone="hover:bg-muted"
            onClick={e => { e.stopPropagation(); onRowClick(r.id) }}><Pencil className="h-3.5 w-3.5" /></RowAction>
        </div>
      ),
      exportValue: null,
    },
  ]
}

export function RulesTable({ rules, loading, selectedIds, onSelectionChange, onRowClick, onSetStatus, activeId }: Props) {
  const [pageSize, setPageSize] = useState(50)

  const columns = useMemo(() => buildColumns(onRowClick, onSetStatus), [onRowClick, onSetStatus])
  // The table speaks Sets; this screen's callers speak arrays. Convert at the seam
  // rather than changing every consumer of RulesTable.
  const selectedKeys = useMemo(() => new Set<string | number>(selectedIds), [selectedIds])

  return (
    <div>
      <DataTable<FlowDecisionRecord, SortKey>
        rows={rules}
        columns={columns}
        getRowKey={r => r.id}
        loading={loading}
        defaultSort={{ field: 'updatedAt', dir: 'desc' }}
        selectable
        selectedKeys={selectedKeys}
        onSelectionChange={keys => onSelectionChange([...keys].map(String))}
        onRowClick={r => onRowClick(r.id)}
        rowClassName={r =>
          `group cursor-pointer ${activeId === r.id ? 'bg-primary/15 ring-1 ring-inset ring-primary/30' : ''}`
        }
        pageSize={pageSize}
        minWidth="min-w-[860px]"
        exportFileName="flow-rules"
        toolbar={
          <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span>לעמוד</span>
            <select
              value={pageSize}
              onChange={e => setPageSize(Number(e.target.value))}
              className="rounded-md border bg-background px-1.5 py-0.5 text-xs"
            >
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        }
        labels={{
          loading: 'Loading rules...',
          empty: 'No rules match these filters — adjust filters or create a new rule.',
        }}
        mobileCard={{
          title: r => r.partDescription,
          subtitle: r => `${r.category} › ${r.schema}`,
          accent: r => r.status,
          fields: [
            { label: 'פורטל', value: r => he(r.lambdaTarget) },
            { label: 'עודכן', value: r => relTime(r.updatedAt) },
          ],
        }}
      />

      {/* legend — what the two icon columns mean */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Activity className="h-3.5 w-3.5 text-cyan-400" /> feedback · confidence</span>
        <span className="inline-flex items-center gap-1"><Zap className="h-3.5 w-3.5 fill-emerald-400 text-emerald-400" /> direct part (skips search)</span>
      </div>
    </div>
  )
}

/** `directPart` is not on the record type but is present on rows that have one. */
function hasDirectPart(r: FlowDecisionRecord): boolean {
  return Boolean((r as FlowDecisionRecord & { directPart?: unknown }).directPart)
}

function RowAction({ title, tone, onClick, children }: { title: string; tone: string; onClick: (e: React.MouseEvent) => void; children: React.ReactNode }) {
  return (
    <button
      title={title} aria-label={title} onClick={onClick}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground ring-1 ring-inset ring-border transition-colors ${tone}`}
    >
      {children}
    </button>
  )
}

// Compact per-rule trust signal: feedback count (usage proxy) + confidence.
// Gives operators an at-a-glance sense of how trusted/active a rule is.
function TrustSignal({ rule }: { rule: FlowDecisionRecord }) {
  const count = rule.feedbackCount ?? 0
  const conf = rule.confidence != null ? Number(rule.confidence) : null
  const tone =
    count >= 100 ? 'text-emerald-400' : count >= 10 ? 'text-cyan-400' : count > 0 ? 'text-foreground' : 'text-muted-foreground'
  const confPct = conf != null && !isNaN(conf) ? `${Math.round(conf * 100)}%` : null
  return (
    <div
      className="flex items-center gap-1.5 text-xs"
      title={`${count} feedback signal${count === 1 ? '' : 's'}${confPct ? ` · ${confPct} confidence` : ''}`}
    >
      <Activity className={`h-3.5 w-3.5 shrink-0 ${tone}`} />
      <span className={`tabular-nums font-medium ${tone}`}>{compactCount(count)}</span>
      {confPct && <span className="text-muted-foreground">· {confPct}</span>}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${FLOW_STATUS_PILL[status] || 'bg-muted text-foreground ring-border'}`}>
      {he(status)}
    </span>
  )
}

function describeVehicle(r: FlowDecisionRecord): string | null {
  const parts: string[] = []
  if (r.vehicleYearFrom || r.vehicleYearTo) {
    parts.push(`${r.vehicleYearFrom ?? '*'}–${r.vehicleYearTo ?? '*'}`)
  }
  if (r.vehicleModel) parts.push(r.vehicleModel)
  if (r.vehicleFuelType) parts.push(r.vehicleFuelType)
  if (r.vehicleEngineModel) parts.push(`engine: ${r.vehicleEngineModel}`)
  if (r.vinPattern) parts.push(`VIN: ${r.vinPattern}`)
  return parts.length ? parts.join(' · ') : null
}
