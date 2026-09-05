'use client'

/**
 * The item's name — when the ERP has given us a number instead.
 *
 * Some catalogue rows carry another part's code in the name field. Item
 * 1623180680 is named '0857428661'; 1574JK is named '0829193289    #####'. A
 * screen that prints that verbatim shows a customer a number belonging to a
 * different part, and the customer has no way to tell.
 *
 * The bulk cache repair only fixes the first 500 candidates catalogue-wide, so
 * a page cannot assume its rows were reached — it has to repair the rows it
 * displays. This component is where that decision lives: it detects the shape
 * (see `looksLikeCodeNotName` — a `/^\d+$/` test misses the '#####' padded form)
 * and then either shows the repaired name a caller supplies, or says the name is
 * unavailable.
 *
 * IT DOES NOT PRINT THE CODE AS A NAME. Some items are genuinely broken in the
 * ERP — 1629058880 resolves to another number and cannot be fixed from here —
 * and for those the honest output is that we do not have a name, not somebody
 * else's part number set in the name's typography.
 */

import { cn } from './cn'
import { Ltr, MixedText } from './Ltr'
import { looksLikeCodeNotName } from './values'

export interface ItemNameProps {
  /** The name exactly as the ERP returned it. */
  raw: string | null | undefined
  /** The item's own code, for the fallback line. */
  code?: string | null
  /**
   * A repaired name from the per-item endpoint, when the caller has fetched it.
   * The bulk cache does not repair every row, so this is often undefined and the
   * component must still behave.
   */
  repaired?: string | null
  /** Render the fallback compactly, for a table cell. */
  compact?: boolean
  className?: string
}

export function ItemName({ raw, code, repaired, compact = false, className }: ItemNameProps) {
  const broken = looksLikeCodeNotName(raw)

  if (!broken && raw) {
    // The ordinary path, and the common one. The comment here used to claim the
    // name was isolated and the code did not do it — which is exactly how
    // `702+` reached a customer as `+702`. MixedText is that claim, implemented.
    return <MixedText className={className}>{raw}</MixedText>
  }

  if (repaired) {
    return <MixedText className={className}>{repaired}</MixedText>
  }

  return (
    <span className={cn('text-[var(--jan-faint)]', className)}>
      שם לא זמין
      {!compact && (
        <span className="ms-2 text-[12px]">
          {code ? <>ה-ERP מחזיר מק״ט במקום שם עבור <Ltr>{code}</Ltr></> : 'ה-ERP מחזיר מק״ט במקום שם'}
        </span>
      )}
    </span>
  )
}

export default ItemName
