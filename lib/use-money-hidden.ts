'use client'

import { useSyncExternalStore } from 'react'
import {
  isMoneyHidden,
  subscribeMoneyHidden,
  getMoneyHiddenServerSnapshot,
} from '@/lib/privacy'

/**
 * Subscribe a component to the money-visibility toggle.
 *
 * IMPORTANT — why this exists even when the return value is ignored:
 * `formatCurrency()` reads the mask state from a module-level store, not from
 * props, so React has no idea a component's output depends on it. Any component
 * that renders money must call this hook so flipping the eye re-renders it.
 * The alternative (remounting the page on toggle) would re-trigger every
 * on-mount fetch — including the slow ones — mid-demo.
 *
 *   export function RevenueCard({ total }: Props) {
 *     useMoneyHidden()                    // subscribe; value unused
 *     return <div>{formatCurrency(total)}</div>
 *   }
 *
 * The boolean is returned for the cases that need to branch themselves — a
 * chart that should flatten its axis, or a cell that hand-rolls its own ₪.
 */
export function useMoneyHidden(): boolean {
  return useSyncExternalStore(
    subscribeMoneyHidden,
    isMoneyHidden,
    getMoneyHiddenServerSnapshot,
  )
}
