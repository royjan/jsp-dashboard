'use client'

import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useReceivables } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ReceivablesPageSkeleton } from '@/components/layout/PageSkeleton'
import { cn } from '@/lib/utils'
import Link from 'next/link'
import {
  Receipt, AlertTriangle, Clock, DollarSign, Search, ArrowUpDown,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie,
} from 'recharts'
import { ILS_FORMAT, NUMBER_FORMAT } from '@/lib/constants'

type SortField = 'name' | 'balance' | 'days_30' | 'days_60' | 'days_90' | 'over_90'
type SortDir = 'asc' | 'desc'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cardVariants: any = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: (i: number) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { delay: i * 0.08, duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] },
  }),
}

const AGING_COLORS = ['#22c55e', '#eab308', '#f97316', '#ef4444', '#dc2626']

function LoadingSkeleton() {
  return <ReceivablesPageSkeleton />
}

export default function ReceivablesPage() {
  const { t } = useLocale()
  const { data, isLoading, error } = useReceivables(20)
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('balance')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const customers = useMemo(() => {
    if (!data?.customers) return []
    let list = data.customers.filter((c: any) =>
      !search || c.name?.toLowerCase().includes(search.toLowerCase()) || c.code?.includes(search)
    )
    list.sort((a: any, b: any) => {
      const aVal = sortField === 'name' ? a.name : (sortField === 'balance' ? a.balance : a.aging[sortField])
      const bVal = sortField === 'name' ? b.name : (sortField === 'balance' ? b.balance : b.aging[sortField])
      if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal
    })
    return list
  }, [data, search, sortField, sortDir])

  const totals = data?.totals

  const agingPieData = totals ? [
    { name: t('currentDebt'), value: totals.total_current },
    { name: t('overdue30'), value: totals.total_30 },
    { name: t('overdue60'), value: totals.total_60 },
    { name: t('overdue90'), value: totals.total_90 },
    { name: t('overdue90Plus'), value: totals.total_over_90 },
  ].filter(d => d.value > 0) : []

  const overdueCount = customers.filter((c: any) =>
    c.aging.days_30 > 0 || c.aging.days_60 > 0 || c.aging.days_90 > 0 || c.aging.over_90 > 0
  ).length

  if (isLoading) return <LoadingSkeleton />
  if (error) return <div className="text-destructive p-4">Error: {(error as Error).message}</div>

  return (
    <div className="space-y-6">
      <h1 className="text-xl sm:text-2xl font-bold">{t('page.receivables')}</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 sm:gap-3">
        {[
          { label: t('totalBalance'), value: ILS_FORMAT.format(totals?.total_balance ?? 0), icon: DollarSign, color: 'text-blue-600' },
          { label: t('currentDebt'), value: ILS_FORMAT.format(totals?.total_current ?? 0), icon: Receipt, color: 'text-green-600' },
          { label: t('overdue30') + '+', value: ILS_FORMAT.format((totals?.total_30 ?? 0) + (totals?.total_60 ?? 0) + (totals?.total_90 ?? 0) + (totals?.total_over_90 ?? 0)), icon: Clock, color: 'text-yellow-600' },
          { label: t('overdue90Plus'), value: ILS_FORMAT.format(totals?.total_over_90 ?? 0), icon: AlertTriangle, color: 'text-red-600' },
          { label: t('overdueCustomers'), value: NUMBER_FORMAT.format(overdueCount), icon: AlertTriangle, color: 'text-orange-600' },
        ].map((kpi, i) => (
          <motion.div key={kpi.label} custom={i} variants={cardVariants} initial="hidden" animate="visible">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <kpi.icon className={cn('h-3.5 w-3.5', kpi.color)} />
                  {kpi.label}
                </div>
                <div className="text-lg font-bold">{kpi.value}</div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Aging Pie */}
        <Card>
          <CardHeader><CardTitle className="text-base">{t('agingBreakdown')}</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={agingPieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false}>
                  {agingPieData.map((_, i) => <Cell key={i} fill={AGING_COLORS[i]} />)}
                </Pie>
                <Tooltip formatter={(v) => ILS_FORMAT.format(v as number)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-2" dir="auto">
              {agingPieData.map((entry, i) => (
                <div key={entry.name} className="flex items-center gap-2 text-sm">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: AGING_COLORS[i] }} />
                  <span className="text-muted-foreground">{entry.name}</span>
                  <span className="font-semibold">{ILS_FORMAT.format(entry.value)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Top Overdue Bar Chart */}
        <Card>
          <CardHeader><CardTitle className="text-base">{t('overdueCustomers')}</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={customers.filter((c: any) => c.aging.over_90 > 0).slice(0, 10)} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis type="number" tickFormatter={(v) => ILS_FORMAT.format(v)} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.length > 20 ? v.substring(0, 20) + '…' : v} />
                <Tooltip formatter={(v) => ILS_FORMAT.format(v as number)} />
                <Bar dataKey="aging.over_90" fill="#ef4444" name={t('overdue90Plus')} radius={[0, 4, 4, 0]}>
                  {customers.filter((c: any) => c.aging.over_90 > 0).slice(0, 10).map((c: any, i: number) => (
                    <Cell key={c.code || i} fill={c.aging.over_90 > 1000 ? '#dc2626' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Customer Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-base">{t('customers')} ({customers.length})</CardTitle>
            <div className="relative">
              <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="ps-8 h-9 rounded-md border bg-background px-3 text-sm w-full sm:w-64"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
            <table className="w-full text-xs sm:text-sm min-w-[700px]">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-start p-2 cursor-pointer" onClick={() => toggleSort('name')}>
                    <span className="flex items-center gap-1">{t('customer')} <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-start p-2">{t('agent')}</th>
                  <th className="text-end p-2 cursor-pointer" onClick={() => toggleSort('balance')}>
                    <span className="flex items-center justify-end gap-1">{t('balance')} <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-end p-2">{t('currentDebt')}</th>
                  <th className="text-end p-2 cursor-pointer" onClick={() => toggleSort('days_30')}>
                    <span className="flex items-center justify-end gap-1">{t('overdue30')} <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-end p-2 cursor-pointer" onClick={() => toggleSort('days_60')}>
                    <span className="flex items-center justify-end gap-1">{t('overdue60')} <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-end p-2 cursor-pointer" onClick={() => toggleSort('days_90')}>
                    <span className="flex items-center justify-end gap-1">{t('overdue90')} <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                  <th className="text-end p-2 cursor-pointer" onClick={() => toggleSort('over_90')}>
                    <span className="flex items-center justify-end gap-1">{t('overdue90Plus')} <ArrowUpDown className="h-3 w-3" /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c: any, i: number) => (
                  <motion.tr
                    key={c.code}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.02, duration: 0.2 }}
                    className="border-b hover:bg-muted/50 transition-colors"
                  >
                    <td className="p-2">
                      <Link href={`/customers/${c.code}`} className="text-primary hover:underline font-medium">
                        {c.name}
                      </Link>
                    </td>
                    <td className="p-2 text-muted-foreground">{c.agent || '-'}</td>
                    <td className="p-2 text-end font-medium">{ILS_FORMAT.format(c.balance)}</td>
                    <td className="p-2 text-end">{c.aging.current ? ILS_FORMAT.format(c.aging.current) : '-'}</td>
                    <td className="p-2 text-end">
                      {c.aging.days_30 > 0 ? <span className="text-yellow-600 font-medium">{ILS_FORMAT.format(c.aging.days_30)}</span> : '-'}
                    </td>
                    <td className="p-2 text-end">
                      {c.aging.days_60 > 0 ? <span className="text-orange-600 font-medium">{ILS_FORMAT.format(c.aging.days_60)}</span> : '-'}
                    </td>
                    <td className="p-2 text-end">
                      {c.aging.days_90 > 0 ? <span className="text-red-500 font-medium">{ILS_FORMAT.format(c.aging.days_90)}</span> : '-'}
                    </td>
                    <td className="p-2 text-end">
                      {c.aging.over_90 > 0 ? <Badge variant="destructive">{ILS_FORMAT.format(c.aging.over_90)}</Badge> : '-'}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
