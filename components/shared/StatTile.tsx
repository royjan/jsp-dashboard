'use client'

/**
 * The dashboard's StatTile is now jan-ui's.
 *
 * There were two implementations of this component with the same name and the
 * same job: a 179-line one here used by 13 screens, and the library's. Neither
 * was a superset, so they were merged upstream — the library gained this file's
 * `icon`, tone-tinted chip, `changePercent`/`higherIsBetter`, `hint`, `onClick`
 * and <StatGrid>; this file gains the library's `provenance`, `spark` and the
 * rule that a pending tile never draws a figure.
 *
 * This shim exists so the 13 call sites keep working unchanged, exactly as
 * `components/shared/DataTable.tsx` does for the 60 that import that one.
 *
 * Nothing about the appearance changes: the palette comes from
 * app/jan-ui-bridge.css (a near-identity mapping onto this app's tokens), and
 * the app's own money-masking and decline-hiding are injected through
 * <JanUIProvider> in app/providers.tsx rather than reimplemented in the library.
 */
export {
  StatTile,
  StatGrid,
  type StatTileProps,
  type StatGridProps,
  type StatTone,
} from '@/lib/jan-ui/StatTile'
export { StatTile as default } from '@/lib/jan-ui/StatTile'
