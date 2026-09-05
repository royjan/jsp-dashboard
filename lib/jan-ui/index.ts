/**
 * jan-ui — the shared surface. Copy `src/` into an app; there is no registry.
 *
 * WHAT THIS APP ACTUALLY USES: `DataTable` (via components/shared/DataTable,
 * 58 call sites) and `JanUIProvider` (app/providers.tsx). Nothing else here is
 * imported anywhere.
 *
 * That matters because several of the dormant exports share a NAME with a live
 * app component and are not the same thing:
 *
 *   StatTile        -> use components/shared/StatTile (12 call sites). The one
 *                      here paints from the --jan-* namespace via
 *                      app/jan-ui-bridge.css, not the app's own tokens.
 *   Button          -> use components/ui/button.
 *   ErrorState /    -> use components/ui/feedback-state. That file and this
 *   EmptyState         one are the same implementation; the app's copy is the
 *                      one the 10 importers point at.
 *
 * They are kept rather than deleted so the module stays portable — the whole
 * point of a copy-vendored library is that it is complete. Import them only if
 * you are lifting jan-ui into another app, never to fill a gap in this one.
 */
export { JanUIProvider, useJanUI, type JanUIConfig } from './provider'
export { DataTable, type DataTableColumn, type DataTableSort, type SortDir } from './DataTable'
export { CalloutMarker, isCalloutAbsent, type CalloutMarkerProps } from './CalloutMarker'
export { StatTile, type StatTileProps } from './StatTile'
export { Chip, type ChipTone } from './Chip'
export { Button, type ButtonProps } from './Button'
export { ErrorState, EmptyState } from './feedback-state'
export { useDensity, setDensity, toggleDensity, type Density } from './density'
export { exportRowsToXlsx, type ExportColumn } from './export-xlsx'
export { sortRows, compareValues } from './sort'
export { cn } from './cn'
export * from './motion'

/* ── Added 2026-09-05 ─────────────────────────────────────────────────────────
   Thirteen components and one util module, none of them yet imported by this
   app. Each one exists because the same bug was found in more than one place:

     Pending / PendingBar   the third feedback state. ErrorState and EmptyState
                            shipped without it, so a value that is not known yet
                            was drawn as `0`.
     NumberFlow             a figure, plus the three ways of not having one —
                            unknown, masked, and a genuine zero.
     StockPill              in / out / UNKNOWN. `null` is not zero.
     ItemName               an ERP name that is really another part's code.
     Ltr / LtrBlock         a Latin run inside Hebrew, isolated so the bidi
                            algorithm stops moving its signs.
     Segmented              the period picker, the view switcher and the mode
                            toggle, which were three implementations.
     StickyHead             a scroll container a sticky <thead> can latch onto.
     WrapRow                a control row that survives an enlarged font size.
     CommandBar             page chrome that folds the half you read once.
     ProgressToast          the wait, in Hebrew, beside the content not on it.
     Freshness              how old the number on screen actually is.
     SelectionScope         a select-all that says what it selected.
     Sparkline / AxisChart  a shape without a scale, and a chart that must have
                            one. The overview chart currently has neither.
     values.ts              dmyToIso / durationToSeconds for sortValue, plus
                            looksLikeCodeNotName and stockState.

   Import them deliberately, the same way as everything above. ────────────── */
export { Pending, PendingBar, useWaitedTooLong, type PendingProps } from './PendingState'
export { NumberFlow, type NumberFlowProps } from './NumberFlow'
export { StockPill, type StockPillProps } from './StockPill'
export { ItemName, type ItemNameProps } from './ItemName'
export { Ltr, LtrBlock, MixedText, type LtrProps } from './Ltr'
export { Segmented, type SegmentedProps, type SegmentedOption } from './Segmented'
export { StickyHead, DEFAULT_MAX_HEIGHT, type StickyHeadProps } from './StickyHead'
export { WrapRow, type WrapRowProps } from './WrapRow'
export { CommandBar, type CommandBarProps } from './CommandBar'
export { ProgressToast, type ProgressToastProps } from './ProgressToast'
export { Freshness, ageLabel, type FreshnessProps } from './Freshness'
export { SelectionScope, type SelectionScopeProps } from './SelectionScope'
export { Sparkline, AxisChart, type SparklineProps, type AxisChartProps, type AxisChartSeries } from './charts'
export { dmyToIso, durationToSeconds, looksLikeCodeNotName, stockState, type StockState } from './values'

/* Entrances, and the two rules that keep them from becoming noise. */
export { Reveal, RevealList, MAX_STAGGERED, type RevealProps, type RevealListProps } from './Reveal'

/* The bottom sheet the phone layouts never had. */
export { Sheet, type SheetProps } from './Sheet'

/* Skeleton to content with neither a layout jump nor a flash. */
export { Swap, SkeletonBar, type SwapProps } from './Swap'

/* Change the row now; send the request in five seconds. */
export { UndoToast, useUndoable, type PendingAction, type UndoToastProps } from './UndoToast'

/* Hold one row while reading it — the table's version of isolating a part. */
export { useFocusRow, FocusExit } from './FocusRow'
