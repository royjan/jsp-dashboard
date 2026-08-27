'use client'

/**
 * The seam between the library and whichever app is using it.
 *
 * DataTable needed exactly two things from the dashboard that are NOT a table's
 * business: how this app formats a number, and whether this app is currently
 * masking money. Those are the only two, and they are the reason the component
 * could not simply be copied — everything else it used (the comparator, the
 * density store, the xlsx writer) is a table concern and ships here.
 *
 * So they are injected rather than imported. An app with no money-masking
 * concept passes nothing and gets sensible defaults; the dashboard passes its
 * own `formatCurrency`/`useMoneyHidden` and behaves exactly as it does today.
 *
 * Deliberately NOT a theme provider. Colour lives in tokens.css as CSS custom
 * properties, so an app can restyle without React re-rendering, and a component
 * dropped into a page inherits the page's palette rather than carrying its own.
 */

import * as React from 'react'

export interface JanUIConfig {
  /** How this app renders a plain number. Defaults to en-US grouping. */
  formatNumber: (value: number | null | undefined, decimals?: number) => string
  /**
   * Whether money is currently hidden (demo mode). The library only needs to
   * know that it CHANGED, so a table re-renders its money cells; it never
   * formats currency itself.
   */
  useMoneyHidden: () => boolean
  /** Locale used by the shared comparator. 'he' matches the dashboard. */
  locale: string
  /**
   * The app's own error / empty states, if it has richer ones.
   *
   * This exists so an app can adopt the shared TABLE without adopting the
   * shared BUTTON. The dashboard's ErrorState is CVA-based and visually richer
   * than the one shipped here, and that difference was the only thing blocking
   * it from dropping its private copy of DataTable — a mechanical migration
   * that would have quietly restyled every error state in the app.
   */
  ErrorState?: React.ComponentType<{
    title?: string
    description?: string
    onRetry?: () => void
    retryLabel?: string
    variant?: 'card' | 'inline'
  }>
  EmptyState?: React.ComponentType<{ title?: string; variant?: 'card' | 'inline' }>
}

const DEFAULTS: JanUIConfig = {
  formatNumber: (v, d = 0) =>
    v == null || !Number.isFinite(Number(v))
      ? '0'
      : Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }),
  // An app with no demo mode is never hiding money. A constant `false` keeps
  // the hook call unconditional, which matters — see DataTable.
  useMoneyHidden: () => false,
  locale: 'he',
}

const Ctx = React.createContext<JanUIConfig>(DEFAULTS)

export function JanUIProvider({
  children,
  ...overrides
}: Partial<JanUIConfig> & { children: React.ReactNode }) {
  const value = React.useMemo(() => ({ ...DEFAULTS, ...overrides }), [
    overrides.formatNumber,
    overrides.useMoneyHidden,
    overrides.locale,
    overrides.ErrorState,
    overrides.EmptyState,
  ])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Usable without a provider — that is the point. Adoption is one import. */
export function useJanUI(): JanUIConfig {
  return React.useContext(Ctx)
}
