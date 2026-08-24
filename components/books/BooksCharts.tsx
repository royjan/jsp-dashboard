'use client'

/**
 * The figures of הנהח״ש.
 *
 * All Recharts, all through the shared kit, so they carry the dashboard's
 * grid, animation, tooltip surface and legend behaviour. Hebrew series names
 * go in `ChartLegendChips` — Recharts' own `<Legend>` truncates them and the
 * chart surface is force-LTR.
 */

import { useMemo, useState } from 'react'
import {
  Area, AreaChart, Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  ACTIVE_BAR, ACTIVE_DOT, ANIM, AXIS_PROPS, BAR_MAX, BAR_RADIUS, CROSSHAIR, ChartCard,
  ChartGrid, ChartLegendChips, ChartRange, ChartTooltipShell, GradientDefs, gradientId,
  useSeriesIsolation,
} from '@/components/charts/kit'
import { CHART_PALETTE, CHART_SEMANTIC } from '@/lib/chart-colors'
import { formatCurrency, formatCurrencyAxis, formatDate } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useBooksText } from './BooksChrome'

const SALES = CHART_PALETTE[0]
const PURCHASES = CHART_PALETTE[1]
const RECEIPTS = CHART_PALETTE[2]

/** 'YYYY-MM' → a short month label in the reader's language. */
function monthLabel(month: string, lang: 'he' | 'en'): string {
  const [y, m] = String(month ?? '').split('-')
  if (!m) return String(month ?? '')
  const date = new Date(Number(y), Number(m) - 1, 1)
  return date.toLocaleDateString(lang === 'en' ? 'en-GB' : 'he-IL', { month: 'short' })
}

const RANGES = [
  { value: '3', labelKey: 'range3m' },
  { value: '6', labelKey: 'range6m' },
  { value: '12', labelKey: 'rangeYear' },
  { value: 'all', labelKey: 'rangeAll' },
] as const

function useRangedMonths<T extends { month: string }>(rows: T[]) {
  const [range, setRange] = useState<string>('all')
  const shown = useMemo(() => {
    if (range === 'all') return rows
    const n = Number(range)
    return rows.slice(-n)
  }, [rows, range])
  return { range, setRange, shown }
}

/** Sales, purchases and receipts by month — bars for the two flows, a line for
 *  the cash actually collected, all on one shekel scale. */
export function MonthlyFlowChart({ months }: { months: any[] }) {
  useMoneyHidden()
  const { t, lang } = useBooksText()
  const isolation = useSeriesIsolation()
  const { range, setRange, shown } = useRangedMonths(months ?? [])

  const data = shown.map((m) => ({
    ...m,
    label: monthLabel(m.month, lang),
    sales: Number(m.sales ?? 0),
    purchases: Number(m.purchases ?? 0),
    receipts: Number(m.receipts ?? 0),
  }))
  const total = data.reduce((s, m) => s + m.sales, 0)
  const series = [
    { key: 'sales', label: t('sales'), color: SALES },
    { key: 'purchases', label: t('purchases'), color: PURCHASES },
    { key: 'receipts', label: t('receipts'), color: RECEIPTS },
  ]

  return (
    <ChartCard
      title={t('monthlyFlow')}
      value={formatCurrency(total)}
      hint={t('monthlyFlowHint')}
      actions={<ChartRange value={range} onChange={setRange}
        options={RANGES.map((r) => ({ value: r.value, label: t(r.labelKey) }))} />}
      legend={<ChartLegendChips items={series.map((s) => ({ ...s }))}
        isolated={isolation.isolated} onIsolate={isolation.setIsolated} />}
    >
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <GradientDefs series={[{ key: 'receipts', color: RECEIPTS }]} />
          <ChartGrid />
          <XAxis dataKey="label" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatCurrencyAxis(v, 'M')} width={52} />
          <Tooltip cursor={{ fill: 'var(--muted)', fillOpacity: 0.35 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return <ChartTooltipShell title={String(label)} rows={series.map((s) => ({
                label: s.label,
                value: formatCurrency(Number(payload[0]?.payload?.[s.key] ?? 0)),
                color: s.color,
              }))} />
            }} />
          <Bar dataKey="sales" fill={SALES} radius={BAR_RADIUS.vertical} maxBarSize={BAR_MAX}
               activeBar={ACTIVE_BAR} fillOpacity={isolation.opacityFor('sales')} {...ANIM.primary} />
          <Bar dataKey="purchases" fill={PURCHASES} radius={BAR_RADIUS.vertical}
               maxBarSize={BAR_MAX} activeBar={ACTIVE_BAR}
               fillOpacity={isolation.opacityFor('purchases')} {...ANIM.secondary} />
          <Line type="monotone" dataKey="receipts" stroke={RECEIPTS} strokeWidth={2}
                dot={false} activeDot={ACTIVE_DOT}
                strokeOpacity={isolation.opacityFor('receipts')} {...ANIM.secondary} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/** Output VAT against input VAT, and the liability the difference leaves. */
export function VatChart({ months }: { months: any[] }) {
  useMoneyHidden()
  const { t, lang } = useBooksText()
  const isolation = useSeriesIsolation()
  const data = (months ?? []).map((m) => ({
    ...m,
    label: monthLabel(m.month, lang),
    vat_out: Number(m.vat_out ?? 0),
    vat_in: Number(m.vat_in ?? 0),
    due: Number(m.due ?? 0),
  }))
  const due = data.reduce((s, m) => s + m.due, 0)
  const series = [
    { key: 'vat_out', label: t('vatOut'), color: CHART_SEMANTIC.bad },
    { key: 'vat_in', label: t('vatIn'), color: CHART_SEMANTIC.good },
    { key: 'due', label: t('vatDue'), color: CHART_PALETTE[2] },
  ]

  return (
    <ChartCard
      title={t('vatChart')}
      value={formatCurrency(due)}
      hint={t('vatDue')}
      legend={<ChartLegendChips items={series} isolated={isolation.isolated}
        onIsolate={isolation.setIsolated} />}
    >
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <ChartGrid />
          <XAxis dataKey="label" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatCurrencyAxis(v)} width={52} />
          <Tooltip cursor={CROSSHAIR} content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            return <ChartTooltipShell title={String(label)} rows={series.map((s) => ({
              label: s.label,
              value: formatCurrency(Number(payload[0]?.payload?.[s.key] ?? 0)),
              color: s.color,
            }))} />
          }} />
          <Bar dataKey="vat_out" fill={CHART_SEMANTIC.bad} radius={BAR_RADIUS.vertical}
               maxBarSize={BAR_MAX} activeBar={ACTIVE_BAR}
               fillOpacity={isolation.opacityFor('vat_out')} {...ANIM.primary} />
          <Bar dataKey="vat_in" fill={CHART_SEMANTIC.good} radius={BAR_RADIUS.vertical}
               maxBarSize={BAR_MAX} activeBar={ACTIVE_BAR}
               fillOpacity={isolation.opacityFor('vat_in')} {...ANIM.secondary} />
          <Line type="monotone" dataKey="due" stroke={CHART_PALETTE[2]} strokeWidth={2}
                dot={false} activeDot={ACTIVE_DOT}
                strokeOpacity={isolation.opacityFor('due')} {...ANIM.secondary} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/** How one account's balance moved through the period. */
export function BalanceAreaChart({ rows, opening }: { rows: any[]; opening: number }) {
  useMoneyHidden()
  const { t } = useBooksText()
  const data = useMemo(() => (rows ?? []).map((r) => ({
    date: r.doc_date,
    label: formatDate(r.doc_date, 'short'),
    balance: Number(r.balance ?? 0),
    detail: r.detail,
  })), [rows])
  if (data.length < 2) return null
  const last = data[data.length - 1].balance

  return (
    <ChartCard title={t('balanceTrend')} value={formatCurrency(last)}
      hint={`${t('opening')}: ${formatCurrency(opening)}`}>
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <GradientDefs series={[{ key: 'balance', color: CHART_PALETTE[2] }]} />
          <ChartGrid />
          <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={40} />
          <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatCurrencyAxis(v)} width={52} />
          <Tooltip cursor={CROSSHAIR} content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const row = payload[0].payload
            return <ChartTooltipShell title={formatDate(row.date)}
              rows={[{ label: t('balance'), value: formatCurrency(row.balance),
                       color: CHART_PALETTE[2] }]}
              footer={row.detail ? <span className="text-muted-foreground">{row.detail}</span> : null} />
          }} />
          <Area type="monotone" dataKey="balance" stroke={CHART_PALETTE[2]} strokeWidth={2}
                fill={`url(#${gradientId('balance')})`} activeDot={ACTIVE_DOT} {...ANIM.primary} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/** Receipts by month — what actually came in. */
export function ReceiptsChart({ months }: { months: any[] }) {
  useMoneyHidden()
  const { t, lang } = useBooksText()
  const data = (months ?? []).map((m) => ({
    label: monthLabel(m.month, lang),
    total: Number(m.total ?? 0),
    count: Number(m.count ?? 0),
  }))
  const total = data.reduce((s, m) => s + m.total, 0)
  return (
    <ChartCard title={t('cashMix')} value={formatCurrency(total)}>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <ChartGrid />
          <XAxis dataKey="label" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatCurrencyAxis(v)} width={52} />
          <Tooltip cursor={{ fill: 'var(--muted)', fillOpacity: 0.35 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const row = payload[0].payload
              return <ChartTooltipShell title={String(label)} rows={[
                { label: t('receipts'), value: formatCurrency(row.total), color: RECEIPTS },
                { label: t('lines'), value: String(row.count), muted: true },
              ]} />
            }} />
          <Bar dataKey="total" fill={RECEIPTS} radius={BAR_RADIUS.vertical}
               maxBarSize={BAR_MAX} activeBar={ACTIVE_BAR} {...ANIM.primary} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/** Cheques still to clear, on a timeline — how much lands, and when. */
export function ChequeTimeline({ cheques }: { cheques: any[] }) {
  useMoneyHidden()
  const { t } = useBooksText()
  const data = useMemo(() => {
    const byDate = new Map<string, { date: string; amount: number; count: number }>()
    for (const c of cheques ?? []) {
      const key = String(c.due_date ?? '')
      if (!key) continue
      const row = byDate.get(key) ?? { date: key, amount: 0, count: 0 }
      row.amount += Number(c.amount ?? 0)
      row.count += 1
      byDate.set(key, row)
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ ...r, label: formatDate(r.date, 'short') }))
  }, [cheques])
  if (!data.length) return null
  const total = data.reduce((s, r) => s + r.amount, 0)

  return (
    <ChartCard title={t('chequeTimeline')} value={formatCurrency(total)}
      hint={`${data.reduce((s, r) => s + r.count, 0)} ${t('cheques')}`}>
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <ChartGrid />
          <XAxis dataKey="label" {...AXIS_PROPS} minTickGap={30} />
          <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatCurrencyAxis(v)} width={52} />
          <Tooltip cursor={{ fill: 'var(--muted)', fillOpacity: 0.35 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const row = payload[0].payload
              return <ChartTooltipShell title={formatDate(row.date)} rows={[
                { label: t('amount'), value: formatCurrency(row.amount), color: PURCHASES },
                { label: t('cheques'), value: String(row.count), muted: true },
              ]} />
            }} />
          <Bar dataKey="amount" fill={PURCHASES} radius={BAR_RADIUS.vertical}
               maxBarSize={BAR_MAX} activeBar={ACTIVE_BAR} {...ANIM.primary} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/** Revenue and collection by fiscal year — the שנים screen's headline. */
export function YearsChart({ totals }: { totals: any[] }) {
  useMoneyHidden()
  const { t } = useBooksText()
  const isolation = useSeriesIsolation()
  const data = (totals ?? []).map((r) => ({
    label: String(r.year),
    sales: Number(r.sales ?? 0),
    purchases: Number(r.purchases ?? 0),
    receipts: Number(r.receipts ?? 0),
  }))
  const series = [
    { key: 'sales', label: t('sales'), color: SALES },
    { key: 'purchases', label: t('purchases'), color: PURCHASES },
    { key: 'receipts', label: t('receipts'), color: RECEIPTS },
  ]
  return (
    <ChartCard title={`${t('sales')} · ${t('receipts')}`}
      legend={<ChartLegendChips items={series} isolated={isolation.isolated}
        onIsolate={isolation.setIsolated} />}>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
          <ChartGrid />
          <XAxis dataKey="label" {...AXIS_PROPS} />
          <YAxis {...AXIS_PROPS} tickFormatter={(v) => formatCurrencyAxis(v, 'M')} width={52} />
          <Tooltip cursor={{ fill: 'var(--muted)', fillOpacity: 0.35 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return <ChartTooltipShell title={String(label)} rows={series.map((s) => ({
                label: s.label,
                value: formatCurrency(Number(payload[0]?.payload?.[s.key] ?? 0)),
                color: s.color,
              }))} />
            }} />
          {series.slice(0, 2).map((s) => (
            <Bar key={s.key} dataKey={s.key} fill={s.color} radius={BAR_RADIUS.vertical}
                 maxBarSize={BAR_MAX} activeBar={ACTIVE_BAR}
                 fillOpacity={isolation.opacityFor(s.key)} {...ANIM.primary} />
          ))}
          <Line type="monotone" dataKey="receipts" stroke={RECEIPTS} strokeWidth={2}
                dot={false} activeDot={ACTIVE_DOT}
                strokeOpacity={isolation.opacityFor('receipts')} {...ANIM.secondary} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
