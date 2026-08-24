/**
 * Writing decoded records into `books.*`.
 *
 * Loading a year is idempotent: every table upserts on its primary key, so a
 * re-run of the same extract changes nothing, and a re-run of a *newer* extract
 * updates the rows that moved. That is what lets the live year be refreshed
 * from its tail every few minutes without bookkeeping drift.
 */

import { query } from '@/lib/db'
import { bareCode } from './btrieve'
import { extractTable, extractTail } from './extract'
import { BANK_ACCOUNTS, LAYOUTS, layoutKeyFor } from './layouts'
import { decodeAll, fingerprint, ledgerRows, type Row } from './records'
import { BOOKS_DDL } from './schema.sql'
import { visualToLogical as vl } from './text'

/** Postgres caps a statement at 65535 parameters; stay well under it. */
const MAX_PARAMS = 30_000

export async function ensureBooksSchema(): Promise<void> {
  await query(BOOKS_DDL)
}

/** Bulk upsert. Chunks by parameter count, not row count, so a wide table
 *  doesn't blow the statement limit. */
async function upsert(table: string, columns: string[], rows: unknown[][],
                      conflict: string): Promise<number> {
  if (!rows.length) return 0
  const perRow = columns.length
  const chunkSize = Math.max(1, Math.floor(MAX_PARAMS / perRow))
  const updates = columns.filter((c) => !conflict.includes(c))
    .map((c) => `${c} = EXCLUDED.${c}`).join(', ')
  let written = 0

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize)
    const params: unknown[] = []
    const tuples = chunk.map((row) => {
      const placeholders = row.map((value) => {
        params.push(value)
        return `$${params.length}`
      })
      return `(${placeholders.join(',')})`
    })
    await query(
      `INSERT INTO ${table} (${columns.join(',')}) VALUES ${tuples.join(',')}
       ON CONFLICT (${conflict}) DO UPDATE SET ${updates}`,
      params,
    )
    written += chunk.length
  }
  return written
}

const LEDGER_COLUMNS = ['year', 'source', 'fp', 'account', 'counter_account', 'doc_date',
  'pay_date', 'reg_date', 'ref1', 'ref2', 'order_num', 'order_line', 'div_code',
  'amount', 'debit', 'credit', 'paid', 'detail', 'rec_type', 'sequence']

export async function loadLedger(year: number, table: '7UPD' | '7MAM',
                                 blob: Buffer): Promise<number> {
  const rows = ledgerRows(year, table, blob)
    .filter((r) => r.account && r.account !== '0')
    .map((r) => LEDGER_COLUMNS.map((c) => (r as unknown as Record<string, unknown>)[c]))
  return upsert('books.ledger', LEDGER_COLUMNS, rows, 'year, source, fp')
}

export async function loadAccounts(year: number, blob: Buffer): Promise<number> {
  const columns = ['year', 'code', 'name', 'class_code', 'city', 'address', 'phone',
    'tax_id', 'credit_days', 'currency', 'agent']
  const seen = new Set<string>()
  const rows: unknown[][] = []
  for (const r of decodeAll('7ACC', blob)) {
    const code = bareCode(String(r.code ?? ''))
    // One file can carry the same card twice (a rewritten record); the last
    // one wins, and a duplicate key inside one INSERT would abort the chunk.
    if (!code || code === '0' || seen.has(code)) continue
    seen.add(code)
    rows.push([year, code, vl(r.name as string), r.class_code, vl(r.city as string),
      vl(r.address as string), r.phone, r.tax_id, r.credit_days, r.currency, r.agent])
  }
  return upsert('books.accounts', columns, rows, 'year, code')
}

export async function loadReceipts(year: number, blob: Buffer): Promise<number> {
  const columns = ['year', 'number', 'format', 'account', 'date', 'name', 'city',
    'phone', 'amount', 'signer', 'time']
  const seen = new Set<string>()
  const rows: unknown[][] = []
  for (const r of decodeAll('7KBH', blob)) {
    const number = String(r.number ?? '')
    if (!number || seen.has(number)) continue
    seen.add(number)
    rows.push([year, number, r.format, bareCode(String(r.account ?? '')), r.date,
      vl(r.name as string), vl(r.city as string), r.phone, r.amount,
      vl(r.signer as string), r.time])
  }
  return upsert('books.receipts', columns, rows, 'year, number')
}

export async function loadReceiptLines(year: number, blob: Buffer): Promise<number> {
  const columns = ['year', 'number', 'line', 'account', 'pay_type', 'due_date', 'bank',
    'branch', 'reference', 'amount', 'deposit_account', 'deposit_ref']
  const seen = new Set<string>()
  const rows: unknown[][] = []
  for (const r of decodeAll('7KBL', blob)) {
    const number = String(r.number ?? '')
    const line = Number(r.line ?? 0)
    const key = `${number}/${line}`
    if (!number || seen.has(key)) continue
    seen.add(key)
    rows.push([year, number, line, bareCode(String(r.account ?? '')), r.pay_type,
      r.due_date, r.bank, r.branch, r.reference, r.amount,
      bareCode(String(r.deposit_account ?? '')), r.deposit_ref])
  }
  return upsert('books.receipt_lines', columns, rows, 'year, number, line')
}

/** The per-bank-account files (7BNK / 7NOT / 7YES) and the payment orders all
 *  key on a record fingerprint — they carry no natural unique column. */
async function loadFingerprinted(
  table: string, year: number, bankAccount: string | null, blob: Buffer,
  layoutKey: string, columns: string[], toRow: (r: Row, fp: string) => unknown[],
): Promise<number> {
  const { recordLength } = LAYOUTS[layoutKeyFor(layoutKey)]
  const seen = new Set<string>()
  const rows: unknown[][] = []
  for (let off = 0; off + recordLength <= blob.length; off += recordLength) {
    const buf = blob.subarray(off, off + recordLength)
    const fp = fingerprint(buf)
    if (seen.has(fp)) continue
    seen.add(fp)
    rows.push(toRow(decodeAll(layoutKey, buf)[0], fp))
  }
  const conflict = bankAccount === null ? 'year, fp' : 'year, bank_account, fp'
  return upsert(table, columns, rows, conflict)
}

export function loadBankLines(year: number, acct: string, blob: Buffer) {
  return loadFingerprinted('books.bank_lines', year, acct, blob, '7BNK',
    ['year', 'bank_account', 'fp', 'page', 'date', 'value_date', 'reference', 'kind',
      'amount', 'balance', 'detail'],
    (r, fp) => [year, acct, fp, r.page, r.date, r.value_date, r.reference, r.kind,
      r.amount, r.balance, vl(r.detail as string)])
}

export function loadCheques(year: number, acct: string, blob: Buffer) {
  return loadFingerprinted('books.cheques', year, acct, blob, '7NOT',
    ['year', 'bank_account', 'fp', 'number', 'date', 'due_date', 'amount', 'reference',
      'account', 'detail', 'code'],
    (r, fp) => [year, acct, fp, r.number, r.date, r.due_date, r.amount, r.reference,
      bareCode(String(r.account ?? '')), vl(r.detail as string), r.code])
}

export function loadBankPayments(year: number, acct: string, blob: Buffer) {
  return loadFingerprinted('books.bank_payments', year, acct, blob, '7YES',
    ['year', 'bank_account', 'fp', 'page', 'date', 'value_date', 'amount', 'reference',
      'account', 'detail', 'code'],
    (r, fp) => [year, acct, fp, r.page, r.date, r.value_date, r.amount, r.reference,
      bareCode(String(r.account ?? '')), vl(r.detail as string), r.code])
}

export function loadPaymentOrders(year: number, blob: Buffer) {
  return loadFingerprinted('books.payment_orders', year, null, blob, '7CHH',
    ['year', 'fp', 'number', 'bank', 'account', 'name', 'city', 'amount', 'date',
      'due_date', 'detail'],
    (r, fp) => [year, fp, r.number, r.bank, bareCode(String(r.account ?? '')),
      vl(r.name as string), vl(r.city as string), r.amount, r.date, r.due_date,
      vl(r.detail as string)])
}

/** Route one extracted file to its loader. Unknown tables are ignored. */
export async function loadTable(year: number, table: string, blob: Buffer): Promise<number> {
  if (table === '7ACC') return loadAccounts(year, blob)
  if (table === '7UPD' || table === '7MAM') return loadLedger(year, table, blob)
  if (table === '7KBH') return loadReceipts(year, blob)
  if (table === '7KBL') return loadReceiptLines(year, blob)
  if (table === '7CHH') return loadPaymentOrders(year, blob)
  const acct = table.slice(4)
  if (table.startsWith('7BNK')) return loadBankLines(year, acct, blob)
  if (table.startsWith('7NOT')) return loadCheques(year, acct, blob)
  if (table.startsWith('7YES')) return loadBankPayments(year, acct, blob)
  return 0
}

/** Record what a year holds and when it was last touched — the watermark the
 *  UI reads to decide whether the numbers are current. */
export async function setYearWatermark(year: number, state: 'closed' | 'live',
                                       source: string, refreshedOnly = false): Promise<void> {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM books.ledger WHERE year = $1 AND source = 'ledger'`,
    [year],
  )
  const ledgerRowCount = rows[0]?.n ?? 0
  if (refreshedOnly) {
    await query(
      `UPDATE books.years SET refreshed_at = now(), ledger_rows = $2, state = $3
       WHERE year = $1`, [year, ledgerRowCount, state],
    )
    return
  }
  await query(
    `INSERT INTO books.years (year, state, loaded_at, refreshed_at, ledger_rows, source)
     VALUES ($1, $2, now(), now(), $3, $4)
     ON CONFLICT (year) DO UPDATE SET
       state = EXCLUDED.state, loaded_at = EXCLUDED.loaded_at,
       refreshed_at = EXCLUDED.refreshed_at, ledger_rows = EXCLUDED.ledger_rows,
       source = EXCLUDED.source`,
    [year, state, ledgerRowCount, source],
  )
}

/**
 * Refresh the live year from the ERP's tail.
 *
 * The ledger and VAT files are walked backwards a few thousand records — that
 * is where today's postings are — while the small cash and bank files are
 * re-read whole, because they cost seconds and a partial cheque list is worse
 * than a slow one.
 */
export async function refreshLiveYear(year: number, tailSize = 6_000) {
  await ensureBooksSchema()
  const merged: Record<string, number> = {}

  for (const table of ['7UPD', '7MAM'] as const) {
    const extract = await extractTail(table, year, tailSize)
    merged[table] = await loadLedger(year, table, extract.blob)
  }
  for (const table of ['7KBH', '7KBL', '7CHH',
    ...BANK_ACCOUNTS.flatMap((a) => [`7BNK${a}`, `7NOT${a}`, `7YES${a}`])]) {
    try {
      const extract = await extractTable(table, year, 240_000)
      merged[table] = await loadTable(year, table, extract.blob)
    } catch (e) {
      // A year can legitimately lack a bank account's file; a genuine failure
      // is logged and skipped rather than aborting the whole refresh.
      console.warn(`[books] refresh skipped ${table} ${year}:`,
                   e instanceof Error ? e.message : e)
    }
  }
  await setYearWatermark(year, 'live', 'tail-refresh', true)
  return merged
}
