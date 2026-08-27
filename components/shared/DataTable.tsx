'use client'

/**
 * The dashboard's DataTable is now jan-ui's.
 *
 * This file exists so the ~25 call sites that import
 * `@/components/shared/DataTable` keep working unchanged. The implementation
 * moved to `lib/jan-ui/`, which jan-portal and partly also copy — one
 * implementation instead of three that drift.
 *
 * Nothing about the dashboard's appearance changes: the palette comes from
 * app/jan-ui-bridge.css (a near-identity mapping onto this app's own tokens),
 * and this app's richer ErrorState/EmptyState are injected through
 * <JanUIProvider> in app/providers.tsx rather than replaced by the library's.
 */
export {
  DataTable,
  type DataTableColumn,
  type DataTableSort,
  type DataTableProps,
  type DataTableLabels,
  type SortDir,
} from '@/lib/jan-ui/DataTable'
export { DataTable as default } from '@/lib/jan-ui/DataTable'
