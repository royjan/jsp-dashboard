'use client'

/**
 * One xlsx export, shared by every DataTable.
 *
 * Four pages each carried their own copy of this (scrap, competitors,
 * stock-forecast, gap/catalog) while the other ~38 tables had no export at all.
 *
 * THE RULE THAT MATTERS: export raw numbers, never formatted strings. A cell
 * holding "₪1,204,833" is text — Excel will not sum it, and the person who
 * asked for the export wanted to sum it. Every call site that got this wrong
 * produced a workbook that looked right and could not be used.
 *
 * `xlsx` is loaded on demand: it is ~400KB, and a button that most sessions
 * never press should not sit in the initial bundle. It is also an OPTIONAL
 * dependency — an app that never passes `exportFileName` needs no xlsx at all,
 * which is why the specifier below is indirect.
 */

/**
 * Only what this file touches. Typing against `typeof import('xlsx')` would put
 * a STATIC reference back into the module and defeat the whole point — an app
 * without xlsx installed would fail to typecheck over a button it never shows.
 */
type Sheet = Record<string, unknown> & { '!cols'?: { wch: number }[]; '!dir'?: string }
interface XlsxLike {
  utils: {
    json_to_sheet(data: unknown[]): Sheet
    book_new(): unknown
    book_append_sheet(wb: unknown, ws: Sheet, name: string): void
  }
  writeFile(wb: unknown, filename: string): void
}

export interface ExportColumn<TRow> {
  /** Column header as written into the sheet. */
  header: string
  /**
   * Cell value. Return a number for anything numeric — NOT a formatted string.
   * `null`/`undefined` become an empty cell.
   */
  value: (row: TRow, index: number) => string | number | null | undefined
  /** Column width in characters. Defaults to a width derived from the header. */
  width?: number
}

export interface ExportOptions {
  /** File name without extension. A date suffix is appended. */
  fileName: string
  /** Sheet tab name. Excel caps this at 31 chars and rejects : \ / ? * [ ]. */
  sheetName?: string
  /** Right-to-left sheet. Defaults to true — this is a Hebrew-first app. */
  rtl?: boolean
}

/** Excel rejects these in a sheet name, and silently corrupts the file if present. */
function safeSheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31) || 'Sheet1'
}

export async function exportRowsToXlsx<TRow>(
  rows: TRow[],
  columns: ExportColumn<TRow>[],
  options: ExportOptions,
): Promise<void> {
  if (!rows.length || !columns.length) return

  // The specifier is indirect on purpose. `import('xlsx')` written literally is
  // resolved by tsc even though the call is dynamic, so an app that has no xlsx
  // dependency fails to BUILD over a button it never renders. Behind a variable
  // it stays what it is: a runtime concern, in an app that opted into exporting.
  const spec = 'xlsx'
  const XLSX = (await import(/* @vite-ignore */ spec)) as unknown as XlsxLike

  const data = rows.map((row, i) => {
    const record: Record<string, string | number | null> = {}
    for (const col of columns) {
      const v = col.value(row, i)
      record[col.header] = v === undefined || v === null ? null : v
    }
    return record
  })

  const ws = XLSX.utils.json_to_sheet(data)
  ws['!cols'] = columns.map(c => ({ wch: c.width ?? Math.max(10, Math.min(40, c.header.length + 4)) }))
  if (options.rtl !== false) ws['!dir'] = 'rtl'

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName(options.sheetName ?? options.fileName))

  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `${options.fileName}-${stamp}.xlsx`)
}

export default exportRowsToXlsx
