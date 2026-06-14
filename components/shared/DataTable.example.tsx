'use client'

/**
 * Usage example for <DataTable>. This file is illustrative only — it is NOT
 * wired into any route. It documents the recommended pattern for migrating one
 * of the hand-rolled tables (e.g. app/scrap, app/stock-forecast) once the
 * current WIP on the working tree is committed.
 */

import { useState } from 'react'
import { DataTable, type DataTableColumn, type DataTableSort } from './DataTable'

interface ScrapRow {
  item_code: string
  item_name: string
  qty: number
  scrap_score: number
}

type ScrapSortKey = 'item_name' | 'qty' | 'scrap_score'

const NUMBER = new Intl.NumberFormat('he-IL')

export function ScrapTableExample({
  rows,
  loading,
  error,
  onRetry,
}: {
  rows: ScrapRow[]
  loading?: boolean
  error?: unknown
  onRetry?: () => void
}) {
  // Sort state lives in the caller (here local; in real pages it's URL/query state).
  const [sort, setSort] = useState<DataTableSort<ScrapSortKey>>({ field: 'scrap_score', dir: 'desc' })

  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.field]
    const bv = b[sort.field]
    if (typeof av === 'string' && typeof bv === 'string') {
      return sort.dir === 'asc' ? av.localeCompare(bv, 'he') : bv.localeCompare(av, 'he')
    }
    return sort.dir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
  })

  const columns: DataTableColumn<ScrapRow, ScrapSortKey>[] = [
    {
      key: 'item_code',
      header: 'קוד',
      // Codes stay LTR + mono; logical start alignment.
      cell: row => <span className="font-mono text-xs text-muted-foreground">{row.item_code}</span>,
    },
    {
      key: 'item_name',
      header: 'שם פריט',
      sortable: true,
      // Hebrew description: truncate + title tooltip, dir="auto" lets BiDi sort it out.
      cell: row => <span dir="auto">{row.item_name}</span>,
      truncate: 'max-w-[220px]',
      title: row => row.item_name,
    },
    {
      key: 'qty',
      header: 'כמות',
      align: 'end', // numeric → tabular-nums auto-applied
      sortable: true,
      cell: row => NUMBER.format(row.qty),
    },
    {
      key: 'scrap_score',
      header: 'ציון גרט',
      align: 'end',
      sortable: true,
      cell: row => row.scrap_score.toFixed(1),
    },
  ]

  return (
    <DataTable
      columns={columns}
      rows={sorted}
      getRowKey={row => row.item_code}
      loading={loading}
      error={error}
      onRetry={onRetry}
      sort={sort}
      onSortChange={setSort}
      onRowClick={row => console.log('open', row.item_code)}
      minWidth="min-w-[800px]"
      maxHeight="600px"
      labels={{ empty: 'אין פריטים לגריטה', error: 'נכשלה טעינת רשימת הגריטה', retry: 'טען מחדש' }}
    />
  )
}
