/**
 * Layout-driven decoding of Btrieve records into rows.
 *
 * Everything here is pure: bytes in, plain objects out. The ERP is never
 * touched from this module — `extract.ts` fetches the bytes, this turns them
 * into rows, and `load.ts` writes them to Postgres.
 */

import { createHash } from 'crypto'
import { bareCode, btrieveDate, extended, fixedString, lstring, u8, u16, u32 } from './btrieve'
import { LAYOUTS, layoutKeyFor, type Field, type TableKey } from './layouts'
import { visualToLogical } from './text'

export type Row = Record<string, string | number | null>

function decodeField(buf: Buffer, [, off, size, type]: Field): string | number | null {
  switch (type) {
    case 'LSTRING': return lstring(buf, off, size - 1)
    case 'CHAR': return fixedString(buf, off, size)
    case 'EXTENDED': return extended(buf, off)
    case 'DATE': return btrieveDate(buf, off)
    case 'UINT8': return u8(buf, off)
    case 'UINT16': return u16(buf, off)
    case 'UINT32': return u32(buf, off)
  }
}

/** Decode one record with the given layout. */
export function decode(table: string, buf: Buffer): Row {
  const layout = LAYOUTS[layoutKeyFor(table)]
  const row: Row = {}
  for (const field of layout.fields) row[field[0]] = decodeField(buf, field)
  return row
}

/** Split a concatenated blob into records and decode each one. */
export function decodeAll(table: string, blob: Buffer): Row[] {
  const { recordLength } = LAYOUTS[layoutKeyFor(table)]
  const rows: Row[] = []
  for (let off = 0; off + recordLength <= blob.length; off += recordLength) {
    rows.push(decode(table, blob.subarray(off, off + recordLength)))
  }
  return rows
}

/**
 * Stable id for one record's bytes — the merge key for the live year.
 *
 * An open-item row mutates as it is settled (`paid` changes), so the
 * fingerprint covers the whole record: a settled row arrives as a new
 * fingerprint for the same posting and replaces it.
 */
export function fingerprint(buf: Buffer): string {
  return createHash('sha1').update(buf).digest('hex').slice(0, 20)
}

/** A ledger posting, ready for `books.ledger`. */
export interface LedgerRow {
  year: number
  source: 'ledger' | 'vat'
  fp: string
  account: string
  counter_account: string
  doc_date: string | null
  pay_date: string | null
  reg_date: string | null
  ref1: string
  ref2: string
  order_num: string
  order_line: number
  div_code: string
  amount: number
  debit: number
  credit: number
  paid: number
  detail: string
  rec_type: number
  sequence: number
}

/** `7UPD` is the ledger, `7MAM` the VAT file — same record shape, one table. */
export function ledgerRow(year: number, table: '7UPD' | '7MAM', buf: Buffer): LedgerRow {
  const r = decode(table, buf)
  const amount = r.amount as number
  const recType = r.rec_type as number
  const debit = recType === 1 ? amount : 0
  const credit = recType === 2 ? amount : 0
  return {
    year,
    source: table === '7UPD' ? 'ledger' : 'vat',
    fp: fingerprint(buf),
    account: bareCode(r.account as string),
    counter_account: bareCode(r.counter_account as string),
    doc_date: r.doc_date as string | null,
    pay_date: r.pay_date as string | null,
    reg_date: r.reg_date as string | null,
    ref1: r.ref1 as string,
    ref2: r.ref2 as string,
    order_num: r.order_num as string,
    order_line: r.order_line as number,
    div_code: r.div_code as string,
    amount: debit - credit,
    debit,
    credit,
    paid: r.paid as number,
    detail: visualToLogical(r.detail as string),
    rec_type: recType,
    sequence: r.sequence as number,
  }
}

/** Decode a whole extracted file into ledger rows. */
export function ledgerRows(year: number, table: '7UPD' | '7MAM', blob: Buffer): LedgerRow[] {
  const { recordLength } = LAYOUTS[table as TableKey]
  const rows: LedgerRow[] = []
  for (let off = 0; off + recordLength <= blob.length; off += recordLength) {
    rows.push(ledgerRow(year, table, blob.subarray(off, off + recordLength)))
  }
  return rows
}
