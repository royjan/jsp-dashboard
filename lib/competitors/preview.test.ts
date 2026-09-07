import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseWorkbook } from '@/lib/competitors/parse-sheets'

/** The dry-run preview maps the parser's own result — this pins the field names it reads. */
function previewOf(wb: XLSX.WorkBook) {
  return parseWorkbook(wb).map(s => ({
    sheet: s.sheetName,
    competitor: s.competitorName,
    parsedRows: s.rows.length,
    rawRows: s.rawRows,
    skippedRows: s.skippedRows,
    errors: s.errors.slice(0, 20),
    sample: s.rows.slice(0, 5).map(r => ({
      itemCode: r.itemCode, name: r.name, brand: r.brand,
      netPrice: r.netPrice, grossPrice: r.grossPrice,
      stockStatus: r.stockStatus, genuineness: r.genuineness,
    })),
  }))
}

describe('competitor upload preview', () => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { 'מק"ט': '9805510580', 'תיאור': 'פנס אחורי', 'מחיר': 1723.38, 'מלאי': 3 },
    { 'מק"ט': '6350HG', 'תיאור': 'פנס ערפל', 'מחיר': 366.36, 'מלאי': 0 },
  ]), 'Comet')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ a: 1 }]), 'Combined')

  const preview = previewOf(wb)

  it('names the competitor each sheet maps to', () => {
    expect(preview.map(p => p.competitor)).toEqual(['Comet'])
  })
  it('drops the summary sheet, as the import does', () => {
    expect(preview.some(p => /combined/i.test(p.sheet))).toBe(false)
  })
  it('reports what would be stored against what is in the file', () => {
    expect(preview[0].parsedRows).toBe(2)
    expect(preview[0].rawRows).toBe(2)
  })
  it('shows a sample row with the fields the table renders', () => {
    const r = preview[0].sample[0]
    expect(r.itemCode).toBe('9805510580')
    expect(r).toHaveProperty('netPrice')
    expect(r).toHaveProperty('stockStatus')
  })
})
