/** jan-ui — the shared surface. Copy `src/` into an app; there is no registry. */
export { JanUIProvider, useJanUI, type JanUIConfig } from './provider'
export { DataTable, type DataTableColumn, type DataTableSort, type SortDir } from './DataTable'
export { CalloutMarker, isCalloutAbsent, type CalloutMarkerProps } from './CalloutMarker'
export { StatTile, StatGrid, type StatTileProps, type StatGridProps, type StatTone } from './StatTile'
export { Chip, type ChipTone } from './Chip'
export { Button, type ButtonProps } from './Button'
export { ErrorState, EmptyState } from './feedback-state'

/* The third feedback state. ErrorState and EmptyState shipped without it, and a
   value that is not known yet was drawn as `0` in the gap. */
export { Pending, PendingBar, useWaitedTooLong, type PendingProps } from './PendingState'

/* Figures, and the three ways of not having one. */
export { NumberFlow, type NumberFlowProps } from './NumberFlow'
export { StockPill, type StockPillProps } from './StockPill'
export { ItemName, type ItemNameProps } from './ItemName'

/* Chrome. */
export { Segmented, type SegmentedProps, type SegmentedOption } from './Segmented'
export { CommandBar, type CommandBarProps } from './CommandBar'
export { ProgressToast, type ProgressToastProps } from './ProgressToast'
export { Freshness, ageLabel, type FreshnessProps } from './Freshness'
export { SelectionScope, type SelectionScopeProps } from './SelectionScope'

/* Layout primitives that encode a bug each. */
export { StickyHead, DEFAULT_MAX_HEIGHT, type StickyHeadProps } from './StickyHead'
export { WrapRow, type WrapRowProps } from './WrapRow'
export { Ltr, LtrBlock, MixedText, type LtrProps } from './Ltr'

/* Charts: one that must show its scale, one that must not pretend to have one. */
export { Sparkline, AxisChart, type SparklineProps, type AxisChartProps, type AxisChartSeries } from './charts'

export { useDensity, setDensity, toggleDensity, type Density } from './density'
export { exportRowsToXlsx, type ExportColumn } from './export-xlsx'
export { sortRows, compareValues } from './sort'
/* Converters for the two rendered shapes that do not sort as themselves. */
export { dmyToIso, durationToSeconds, looksLikeCodeNotName, stockState, type StockState } from './values'
export { cn } from './cn'
export * from './motion'
export { copyText } from './clipboard'

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
