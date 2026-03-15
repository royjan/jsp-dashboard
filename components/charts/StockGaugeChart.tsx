'use client'

import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useLocale } from '@/lib/locale-context'

interface StockGaugeChartProps {
  label: string
  value: number // 0-100
  total: number
  healthy: number
}

const GAUGE_COLORS = ['#34d399', '#fbbf24', '#f87171']

export function StockGaugeChart({ label, value, total, healthy }: StockGaugeChartProps) {
  const { t } = useLocale()
  const percent = total > 0 ? (healthy / total) * 100 : 0
  const data = [
    { name: t('healthy'), value: percent },
    { name: '', value: 100 - percent },
  ]

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="text-sm">{label}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        <ResponsiveContainer width="100%" height={120}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="100%"
              startAngle={180}
              endAngle={0}
              innerRadius={50}
              outerRadius={70}
              dataKey="value"
              stroke="none"
            >
              <Cell fill={percent > 70 ? GAUGE_COLORS[0] : percent > 40 ? GAUGE_COLORS[1] : GAUGE_COLORS[2]} />
              <Cell fill="var(--muted)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="text-center -mt-4">
          <p className="text-2xl font-bold">{percent.toFixed(0)}%</p>
          <p className="text-xs text-muted-foreground">{healthy} / {total} {t('itemsHealthy')}</p>
        </div>
      </CardContent>
    </Card>
  )
}
