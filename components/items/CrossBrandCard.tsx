'use client'

import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { familyChipClasses, type BrandFamily } from '@/lib/brand'
import { ArrowLeft, ArrowRight, ExternalLink, Shuffle } from 'lucide-react'

/** One scanned vehicle of a foreign brand, deep-linked into partly at its diagram. */
export interface OtherBrandFit { label: string; vin?: string; url: string; schema?: string | null; demo?: boolean }

/** Mirrors `OtherBrand` in app/api/items/[code]/route.ts. */
export interface OtherBrand {
  brand: BrandFamily | string
  label: string
  description: string | null
  hebrew: string | null
  shared_numbering: boolean
  fits: OtherBrandFit[]
  total: number
  href: string
}

/**
 * "Same number, other manufacturer" — deliberately NOT the equivalents card.
 *
 * `PartLinksCard` (חלקים מקבילים בין יצרנים) lists parts that ARE the same
 * part under different numbers, proven by a shared drawing. This card lists
 * manufacturers that print THIS number on their own cars, which proves
 * nothing: Volvo's 401165 and PSA's 401165 are two parts. Each row shows what
 * the other catalog calls the number, a few of its cars at their drawings, and
 * a link that opens the number as THAT brand's part — its own page, its own
 * drawings, none of our ERP figures.
 *
 * The one softening is `shared_numbering`: Fiat/PSA (Sevel) and MG/Opel (GM
 * numbers) share a scheme, and there the same number usually IS the same part.
 * The row says so instead of leaving the reader to guess.
 */
export function CrossBrandCard({ brands, isHe }: { brands?: OtherBrand[]; isHe: boolean }) {
  if (!brands?.length) return null
  const Arrow = isHe ? ArrowLeft : ArrowRight
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Shuffle className="h-4 w-4 text-amber-500" />
          {isHe ? 'חלקים שונים בין יצרנים' : 'Same number, other brands'}
          <Badge variant="secondary" className="text-xs">{brands.length}</Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          {isHe
            ? 'אותו מק״ט מופיע גם בקטלוג של יצרן אחר — לא בהכרח אותו חלק, ולא במחיר שלנו.'
            : "The same item number also appears in another manufacturer's catalog — not necessarily the same part, and not at our price."}
        </p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {brands.map((b) => {
            const wording = b.hebrew || b.description
            return (
              <li key={b.brand} className="py-3 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium leading-none ${familyChipClasses(b.brand)}`}>
                    {b.label}
                  </span>
                  {wording ? (
                    <span className="text-sm" dir="auto">{wording}</span>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {isHe ? `אין תיאור מהקטלוג של ${b.label}` : `No wording from the ${b.label} catalog`}
                    </span>
                  )}
                  {b.shared_numbering && (
                    <span className="text-xs text-muted-foreground">
                      {isHe ? '(מספור משותף — לרוב אותו חלק)' : '(shared numbering — usually the same part)'}
                    </span>
                  )}
                  <Link
                    href={b.href}
                    className="ms-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {isHe ? `פתח כחלק ${b.label}` : `Open as ${b.label} part`}
                    <Arrow className="h-3 w-3" />
                  </Link>
                </div>
                <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  {b.fits.map((f) => (
                    <li key={f.vin || f.label} className="inline-flex items-center gap-1">
                      <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                        {f.label}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      {f.schema && <span className="text-muted-foreground truncate max-w-[16rem]" dir="auto">· {f.schema}</span>}
                      {f.demo && <span className="text-muted-foreground">({isHe ? 'סריקת ניסיון' : 'trial scan'})</span>}
                    </li>
                  ))}
                  {b.total > b.fits.length && (
                    <li className="text-muted-foreground">
                      {isHe ? `ועוד ${b.total - b.fits.length} רכבים` : `+${b.total - b.fits.length} more vehicles`}
                    </li>
                  )}
                </ul>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
