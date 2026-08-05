import type { WorkBook } from 'xlsx'
import * as XLSX from 'xlsx'

/**
 * Parser for competitor price-list workbooks (Record / Comet / RunParts / …).
 * Pure functions, no DB — the upload route feeds it a parsed XLSX WorkBook.
 *
 * Sheet naming contract: every sheet is a competitor named after the sheet,
 * except derived/summary sheets (e.g. "Combined") which are skipped.
 */

export type StockStatus = 'in_stock' | 'out_of_stock' | 'unknown'
export type Genuineness = 'genuine' | 'aftermarket' | 'unknown'

/** Upper sanity bounds — anything past these is a parse artefact, not data. */
const MAX_PRICE = 1_000_000
const MAX_STOCK = 100_000

/**
 * Genuine (OEM) vs aftermarket, from the sheet's brand/manufacturer column.
 * 'מקורי' (Record), 'GENUINE PARTS' (Comet) and the PSA marques RunParts sells
 * under (CITROEN/PEUGEOT/DS/OPEL) all mean a genuine part.
 */
export function classifyGenuineness(brand: string | null | undefined): Genuineness {
  const b = (brand || '').trim()
  if (!b) return 'unknown'
  if (/מקורי|genuine|original|\bOEM\b/i.test(b)) return 'genuine'
  if (/^(citroen|citroën|peugeot|\bDS\b|opel|vauxhall|psa|stellantis)/i.test(b)) return 'genuine'
  if (/חליפי|תחליפי|aftermarket|after.?market/i.test(b)) return 'aftermarket'
  return 'aftermarket'
}

export interface ParsedCompetitorRow {
  itemCode: string
  rawCode: string
  name: string | null
  brand: string | null
  grossPrice: number | null
  netPrice: number | null
  discountPct: number | null
  stockQty: number | null
  stockStatus: StockStatus
  genuineness: Genuineness
  oemCodes: string[]
  attrs: Record<string, unknown> | null
}

export interface SheetParseResult {
  sheetName: string
  competitorName: string
  rows: ParsedCompetitorRow[]
  rawRows: number
  skippedRows: number
  errors: string[]
}

/** Derived/summary sheets that are not a competitor catalog. */
const SKIP_SHEETS = [/^combined/i, /^סיכום/, /^summary/i]

/**
 * Supplier prefixes Comet puts in front of the real part number
 * (ORG/DIN/SOE/PEU/TYE — 191 of its 195 rows carry one).
 */
const SUPPLIER_PREFIX = /^(ORG|DIN|SOE|PEU|TYE)(?=[A-Z0-9]{4,})/

/**
 * Canonical OEM code: supplier prefix stripped, separators (dots, spaces,
 * dashes, quote marks) removed, uppercased.
 * 'DIN0249.E6' → '0249E6', '1531.30' → '153130', 'PEU0805.K3' → '0805K3'.
 * Jan catalog codes are passed through the same function before matching.
 */
export function normalizeOemCode(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    // Separators go first: Comet writes both 'DIN0249.E6' and 'ORG 9847019780',
    // so the prefix is only adjacent to the number once spacing is gone.
    .replace(/[.\s\-'"׳״]/g, '')
    .replace(SUPPLIER_PREFIX, '')
}

/**
 * '29.00 ₪' / 916 / '1,022.50' → number. Anything that isn't a finite positive
 * amount within sane bounds becomes null: 0 means "not quoted", never "free",
 * and a value past MAX_PRICE is a mis-parsed cell rather than a real price.
 */
export function parseMoney(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[₪,\s]/g, ''))
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PRICE) return null
  return Math.round(n * 100) / 100
}

/** Discount %: a real percentage or nothing. */
function parsePct(v: unknown): number | null {
  const n = parseMoney(v)
  return n !== null && n <= 100 ? n : null
}

/**
 * Stock from a numeric qty column (Record/RunParts) and/or a text status
 * column (Comet's מצב מלאי: 'חסר במלאי' = out; empty = in stock).
 */
export function parseStock(qty: unknown, statusText?: unknown, emptyStatusMeansInStock = false): { stockQty: number | null; stockStatus: StockStatus } {
  const text = String(statusText ?? '').trim()
  if (text) {
    if (/חסר|אזל|לא במלאי|out/i.test(text)) return { stockQty: null, stockStatus: 'out_of_stock' }
    if (/במלאי|in/i.test(text)) return { stockQty: null, stockStatus: 'in_stock' }
  }
  if (qty !== null && qty !== undefined && qty !== '') {
    const n = typeof qty === 'number' ? qty : Number(String(qty).replace(/[,\s]/g, ''))
    if (Number.isFinite(n) && n >= 0 && n <= MAX_STOCK) {
      const rounded = Math.round(n)
      return { stockQty: rounded, stockStatus: rounded > 0 ? 'in_stock' : 'out_of_stock' }
    }
  }
  if (emptyStatusMeansInStock) return { stockQty: null, stockStatus: 'in_stock' }
  return { stockQty: null, stockStatus: 'unknown' }
}

type RawRow = Record<string, unknown>

/** First non-empty cell among header aliases. */
function pick(row: RawRow, aliases: string[]): unknown {
  for (const a of aliases) {
    const v = row[a]
    if (v !== undefined && v !== null && String(v).trim() !== '') return v
  }
  return undefined
}

function str(v: unknown): string | null {
  const s = String(v ?? '').trim()
  return s || null
}

interface SheetConfig {
  map: (row: RawRow) => Omit<ParsedCompetitorRow, 'itemCode'> | null
  /** Merge duplicate codes within a sheet (Record: one row per vehicle fitment). */
  mergeDuplicates?: (base: ParsedCompetitorRow, dup: ParsedCompetitorRow) => void
}

const CODE_ALIASES = ['מק"ט', 'מק״ט', 'קוד פריט', 'item_code', 'code', 'SKU', 'sku']
const NAME_ALIASES = ['שם פריט', 'תיאור', 'name', 'description']
const BRAND_ALIASES = ['מותג', 'ספק/יצרן', 'יצרן', 'brand', 'supplier']
const GROSS_ALIASES = ['ברוטו ₪', 'ברוטו', 'gross']
const NET_ALIASES = ['נטו ₪', 'נטו', 'net', 'price', 'מחיר']
const DISCOUNT_ALIASES = ['הנחה %', 'הנחה', 'discount']
const STOCK_QTY_ALIASES = ['מלאי', 'כמות', 'stock', 'qty']
const STOCK_STATUS_ALIASES = ['מצב מלאי', 'stock_status']
const OEM_ALIASES = ['מק"ט OEM', 'מק״ט OEM', 'OEM', 'oem_codes']

function vehicleFromRecordRow(row: RawRow): Record<string, string> | null {
  const vehicle: Record<string, string> = {}
  const make = str(row['רכב']); const model = str(row['דגם'])
  const years = str(row['שנים']); const engine = str(row['נפח'])
  if (make) vehicle.make = make
  if (model) vehicle.model = model
  if (years) vehicle.years = years
  if (engine) vehicle.engine = engine
  return Object.keys(vehicle).length ? vehicle : null
}

function genericMap(row: RawRow): Omit<ParsedCompetitorRow, 'itemCode'> | null {
  const rawCode = str(pick(row, CODE_ALIASES))
  if (!rawCode) return null
  const oemRaw = str(pick(row, OEM_ALIASES))
  const selfCode = normalizeOemCode(rawCode)
  const oemCodes = oemRaw
    ? [...new Set(oemRaw.split(',').map(normalizeOemCode).filter(c => c && c !== selfCode))]
    : []
  const brand = str(pick(row, BRAND_ALIASES))
  return {
    rawCode,
    name: str(pick(row, NAME_ALIASES)),
    brand,
    grossPrice: parseMoney(pick(row, GROSS_ALIASES)),
    netPrice: parseMoney(pick(row, NET_ALIASES)),
    discountPct: parsePct(pick(row, DISCOUNT_ALIASES)),
    ...parseStock(pick(row, STOCK_QTY_ALIASES), pick(row, STOCK_STATUS_ALIASES)),
    genuineness: classifyGenuineness(brand),
    oemCodes,
    attrs: null,
  }
}

const SHEET_CONFIGS: Record<string, SheetConfig> = {
  // Record: one row per vehicle fitment — dedupe per code, merge fitments.
  record: {
    map: (row) => {
      const base = genericMap(row)
      if (!base) return null
      const vehicle = vehicleFromRecordRow(row)
      const additional = str(row['רכבים נוספים'])
      base.attrs = vehicle || additional ? { vehicles: vehicle ? [vehicle] : [], additional: additional || undefined } : null
      return base
    },
    mergeDuplicates: (base, dup) => {
      const vehicles = ((base.attrs?.vehicles as Record<string, string>[] | undefined) ?? [])
      const dupVehicles = (dup.attrs?.vehicles as Record<string, string>[] | undefined) ?? []
      for (const v of dupVehicles) {
        if (!vehicles.some(x => JSON.stringify(x) === JSON.stringify(v))) vehicles.push(v)
      }
      base.attrs = { ...(base.attrs || {}), ...(dup.attrs || {}), vehicles }
    },
  },
  // Comet: text stock status (empty = in stock), OEM cross-codes column.
  comet: {
    map: (row) => {
      const base = genericMap(row)
      if (!base) return null
      const stock = parseStock(undefined, pick(row, STOCK_STATUS_ALIASES), true)
      base.stockQty = stock.stockQty
      base.stockStatus = stock.stockStatus
      const barcode = str(row['ברקוד'])
      base.attrs = barcode ? { barcode } : null
      return base
    },
  },
  // RunParts: numeric stock, MOQ/location/bestseller/external id extras.
  runparts: {
    map: (row) => {
      const base = genericMap(row)
      if (!base) return null
      const attrs: Record<string, unknown> = {}
      const moq = parseMoney(row['MOQ'])
      const location = str(row['מיקום'])
      const bestseller = str(row['Bestseller'])
      const externalId = str(row['id'])
      if (moq) attrs.moq = moq
      if (location && location !== 'unknown') attrs.location = location
      if (bestseller) attrs.bestseller = bestseller
      if (externalId) attrs.externalId = externalId
      base.attrs = Object.keys(attrs).length ? attrs : null
      return base
    },
  },
}

/** 'Record (1474)' → 'Record' — export sheets append row counts to titles. */
function baseSheetName(sheetName: string): string {
  return sheetName.replace(/\s*\(\d+\)\s*$/, '').trim()
}

function parseSheet(sheetName: string, rawRows: RawRow[]): SheetParseResult {
  const competitorName = baseSheetName(sheetName)
  const config = SHEET_CONFIGS[competitorName.toLowerCase()] ?? { map: genericMap }
  const byCode = new Map<string, ParsedCompetitorRow>()
  const errors: string[] = []
  let skipped = 0
  let mergedDuplicates = 0

  rawRows.forEach((row, i) => {
    const mapped = config.map(row)
    const itemCode = mapped ? normalizeOemCode(mapped.rawCode) : ''
    if (!mapped || !itemCode) {
      skipped++
      errors.push(`Row ${i + 2}: missing or invalid item code`)
      return
    }
    const full: ParsedCompetitorRow = { itemCode, ...mapped }
    const existing = byCode.get(itemCode)
    if (existing) {
      mergedDuplicates++
      if (config.mergeDuplicates) config.mergeDuplicates(existing, full)
      // else: first row wins (duplicate rows in these sheets repeat the same price/stock)
    } else {
      byCode.set(itemCode, full)
    }
  })

  if (mergedDuplicates && !config.mergeDuplicates) {
    errors.push(`${mergedDuplicates} duplicate code rows collapsed (first occurrence kept)`)
  }

  return {
    sheetName,
    competitorName,
    rows: [...byCode.values()],
    rawRows: rawRows.length,
    skippedRows: skipped,
    errors,
  }
}

/** Parse all competitor sheets of a workbook; derived sheets (Combined etc.) are skipped. */
export function parseWorkbook(wb: WorkBook): SheetParseResult[] {
  const results: SheetParseResult[] = []
  for (const sheetName of wb.SheetNames) {
    if (SKIP_SHEETS.some(re => re.test(sheetName.trim()))) continue
    const rawRows = XLSX.utils.sheet_to_json<RawRow>(wb.Sheets[sheetName], { defval: '' })
    if (!rawRows.length) continue
    results.push(parseSheet(sheetName, rawRows))
  }
  return results
}
