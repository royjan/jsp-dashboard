'use client'

/**
 * The three price screens, linked to each other.
 *
 * /pricing (elasticity), /margin and /competitors each answer a different
 * question about the same decision — what to charge — and none of them linked
 * to the other two, so getting from one to the next meant going back out to the
 * sidebar and knowing they were related in the first place.
 *
 * Defined once rather than inline in three files: a fourth price screen should
 * be a one-line change here, not a hunt for the other copies.
 */

import { SubTabs } from '@/components/shared/SubTabs'
import { useLocale } from '@/lib/locale-context'

export function PricingTabs() {
  const { t } = useLocale()
  return (
    <SubTabs
      tabs={[
        { href: '/pricing', label: t('pricing') },
        { href: '/margin', label: t('margin') },
        { href: '/competitors', label: t('competitors') },
      ]}
    />
  )
}
