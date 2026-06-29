'use client'

import { use } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemLink } from '@/components/shared/ItemLink'
import { CustomerLink } from '@/components/shared/CustomerLink'
import { ILS_FORMAT } from '@/lib/constants'
import { ArrowRight, FileText, ExternalLink } from 'lucide-react'

const DOC_TYPE_NAMES: Record<string, string> = {
  '11': 'חשבונית מס', '12': 'זיכוי', '14': 'חשבונית עסקה',
  '21': 'תעודת משלוח', '31': 'הצעת מחיר', '61': 'הזמנה',
}

interface DocLine {
  line_number?: number
  item_code?: string
  item_name?: string
  quantity?: number
  unit_price?: number
  discount_percent?: number
  line_total?: number
}
interface DocDetail {
  doc_number?: string
  format?: string
  format_name?: string
  doc_date?: string
  due_date?: string
  customer_code?: string
  customer_name?: string
  total?: number
  vat?: number
  grand_total?: number
  lines?: DocLine[]
  error?: string
}

const ils = (n?: number) => (n != null ? ILS_FORMAT.format(n) : '—')

export default function DocumentDetailPage({
  params,
}: {
  params: Promise<{ format: string; number: string }>
}) {
  const { format, number } = use(params)
  const searchParams = useSearchParams()
  const year = searchParams.get('year') || ''

  const { data, isLoading, error } = useQuery<DocDetail>({
    queryKey: ['document', format, number, year],
    queryFn: async () => {
      const res = await fetch(`/api/documents/${format}/${number}${year ? `?year=${year}` : ''}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 10 * 60 * 1000,
  })

  const typeName = data?.format_name || DOC_TYPE_NAMES[format] || `מסמך ${format}`
  const lines = data?.lines || []

  return (
    <div className="space-y-4" dir="rtl">
      <button onClick={() => window.history.back()} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowRight className="h-4 w-4" /> חזרה
      </button>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : error || data?.error ? (
        <Card><CardContent className="py-10 text-center text-sm text-destructive">
          המסמך לא נמצא{data?.error ? ` — ${data.error}` : ''}
        </CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                {typeName} #{data?.doc_number || number}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {data?.customer_code && (
                  <div>
                    <div className="text-xs text-muted-foreground">לקוח</div>
                    <CustomerLink code={data.customer_code} name={data.customer_name} className="font-medium" />
                  </div>
                )}
                <div>
                  <div className="text-xs text-muted-foreground">תאריך</div>
                  <div>{(data?.doc_date || '').slice(0, 10) || '—'}</div>
                </div>
                {data?.due_date && (
                  <div>
                    <div className="text-xs text-muted-foreground">לתשלום עד</div>
                    <div>{data.due_date.slice(0, 10)}</div>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 pt-2 border-t">
                <span><span className="text-muted-foreground">סכום: </span><span className="font-medium tabular-nums">{ils(data?.total)}</span></span>
                <span><span className="text-muted-foreground">מע״מ: </span><span className="font-medium tabular-nums">{ils(data?.vat)}</span></span>
                <span><span className="text-muted-foreground">סה״כ: </span><span className="font-bold tabular-nums">{ils(data?.grand_total)}</span></span>
              </div>
              <a
                href={`/api/documents/${format}/${number}/pdf${year ? `?year=${year}` : ''}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline pt-1"
              >
                <ExternalLink className="h-3 w-3" /> PDF מקורי (FINAPI) — הערה: עברית עשויה להופיע הפוך
              </a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">פריטים ({lines.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="p-2 text-start">#</th>
                      <th className="p-2 text-start">קוד</th>
                      <th className="p-2 text-start">תיאור</th>
                      <th className="p-2 text-end">כמות</th>
                      <th className="p-2 text-end">מחיר</th>
                      <th className="p-2 text-end">הנחה</th>
                      <th className="p-2 text-end">סה״כ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="p-2 text-muted-foreground">{l.line_number ?? i + 1}</td>
                        <td className="p-2">{l.item_code ? <ItemLink code={l.item_code} showCode /> : '—'}</td>
                        <td className="p-2 max-w-[280px] truncate" title={l.item_name}>{l.item_name || '—'}</td>
                        <td className="p-2 text-end tabular-nums">{l.quantity ?? '—'}</td>
                        <td className="p-2 text-end tabular-nums">{ils(l.unit_price)}</td>
                        <td className="p-2 text-end tabular-nums">{l.discount_percent ? `${l.discount_percent}%` : '—'}</td>
                        <td className="p-2 text-end tabular-nums font-medium">{ils(l.line_total)}</td>
                      </tr>
                    ))}
                    {lines.length === 0 && (
                      <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">אין שורות במסמך</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
