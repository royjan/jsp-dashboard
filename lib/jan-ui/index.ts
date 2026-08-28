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
