'use client'

/**
 * Every name this part goes by, and who calls it that.
 *
 * The card above shows one name, picked by a precedence chain that never says
 * which source it used. That hides genuine disagreement — the manufacturer's
 * catalogue, the official distributor's price list and a competitor's sheet
 * routinely describe the same part differently, and the difference is often the
 * fastest way to tell whether you are looking at the right part at all.
 *
 * One caveat worth knowing when reading this: the Xpart rows are attributed to
 * the import CHANNEL, not the supplier. All suppliers' price-list wording
 * collapses into a single 'price_list' row upstream, last import wins, so this
 * is not "what each supplier calls it". Competitor rows are per-competitor and
 * are the exception.
 */

import { useQuery } from '@tanstack/react-query'
import { Tags } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FreshnessChip } from '@/components/shared/FreshnessChip'
import type { Provenance } from '@/lib/provenance'

interface Alias {
  source: string
  sourceKind: 'xpart' | 'catalog' | 'competitor' | 'distributor'
  language: string | null
  description: string
  isPrimary?: boolean
}

interface Response {
  aliases: Alias[]
  distinctNames: number
  provenance: Provenance
}

const KIND_TONE: Record<Alias['sourceKind'], string> = {
  xpart: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  catalog: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  competitor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  distributor: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
}

const SOURCE_LABEL_HE: Record<string, string> = {
  price_list: 'מחירון ספק',
  finansit: 'ERP',
  supplier_response: 'תשובת ספק',
  shipment_import: 'משלוח',
  catalog: 'קטלוג היצרן',
}

export function ItemAliasesCard({ code, isHe }: { code: string; isHe: boolean }) {
  const { data, isLoading } = useQuery<Response>({
    queryKey: ['item-aliases', code],
    queryFn: async () => {
      const res = await fetch(`/api/items/${encodeURIComponent(code)}/descriptions`)
      if (!res.ok) throw new Error('descriptions unavailable')
      return res.json()
    },
    enabled: !!code,
    staleTime: 60 * 60 * 1000,
  })

  // A part with one name everywhere needs no card — this only earns its space
  // when the sources disagree.
  if (isLoading || !data || data.aliases.length === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Tags className="h-4 w-4 text-violet-500" />
          {isHe ? 'שמות הפריט לפי מקור' : 'Names by source'}
          <span className="text-xs font-normal text-muted-foreground">
            {isHe ? `${data.distinctNames} שמות שונים` : `${data.distinctNames} distinct`}
          </span>
          <FreshnessChip provenance={data.provenance} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.aliases.map((a, i) => (
          <div key={`${a.source}-${a.language}-${i}`} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-sm">
            <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${KIND_TONE[a.sourceKind]}`}>
              {isHe ? (SOURCE_LABEL_HE[a.source] ?? a.source) : a.source}
            </span>
            {a.language && (
              <Badge variant="outline" className="text-[10px] uppercase">
                {a.language}
              </Badge>
            )}
            <span dir="auto" className="min-w-0 break-words">
              {a.description}
            </span>
          </div>
        ))}
        <p className="pt-1 text-[11px] text-muted-foreground">
          {isHe
            ? 'מקורות Xpart מסומנים לפי ערוץ הייבוא ולא לפי ספק — כל מחירוני הספקים נשמרים באותה שורה ב‑Xpart. שורות מתחרים הן לפי מתחרה.'
            : 'Xpart rows are labelled by import channel, not supplier — all suppliers’ price lists share one row upstream. Competitor rows are per competitor.'}
        </p>
      </CardContent>
    </Card>
  )
}
