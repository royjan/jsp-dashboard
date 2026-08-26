'use client'

import { Rows2, Rows4 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDensity, toggleDensity } from '@/lib/use-density'

/**
 * Comfortable ↔ compact row height for every DataTable at once.
 *
 * Same shape as MoneyToggle: a module store rather than a provider, because
 * DataTable is mounted in ~40 places that share no provider boundary.
 *
 * Compact roughly doubles the rows on screen, which is the difference between
 * scanning a stock or ledger table and paging through it. Comfortable stays the
 * default — it is the touch target the /sales-rep screens are built around.
 */
export function DensityToggle({ labelled = false }: { labelled?: boolean }) {
  const density = useDensity()
  const compact = density === 'compact'
  const label = compact ? 'תצוגה מרווחת' : 'תצוגה דחוסה'

  return (
    <Button
      variant="ghost"
      size={labelled ? 'sm' : 'icon'}
      onClick={() => toggleDensity()}
      title={label}
      aria-label={label}
      aria-pressed={compact}
      className={
        (labelled ? 'gap-1.5 text-xs ' : '') + (compact ? 'text-primary' : 'text-muted-foreground')
      }
    >
      {compact ? <Rows4 className="h-4 w-4" /> : <Rows2 className="h-4 w-4" />}
      <span className={labelled ? undefined : 'sr-only'}>{label}</span>
    </Button>
  )
}

export default DensityToggle
