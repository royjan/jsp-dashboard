/**
 * Record layouts for the Finansit Btrieve files the books read.
 *
 * A layout is a list of `[name, offset, size, type]`. Offsets are byte
 * positions inside one fixed-length record; for LSTRING the offset points at
 * the length byte and `size` counts that byte plus its payload — the convention
 * the Finansit DDFs use.
 *
 * Provenance: reverse-engineered from the files themselves and verified
 * field-by-field against the same books in acc.contra.co.il — 61,436 of 61,436
 * ledger rows matched exactly on account, date, reference, debit and credit;
 * all 1,860 receipts equal the sum of their payment lines.
 */

export type FieldType = 'LSTRING' | 'CHAR' | 'EXTENDED' | 'DATE' | 'UINT8' | 'UINT16' | 'UINT32'
export type Field = readonly [name: string, offset: number, size: number, type: FieldType]

export interface TableLayout {
  /** File name pattern; `{acct}` is filled for the per-bank-account files. */
  file: string
  recordLength: number
  fields: readonly Field[]
}

/** Ledger movements — one row per posting line. This is the journal behind
 *  every ledger card (כרטסת), the trial balance and the VAT return.
 *
 *  `rec_type` is the side of the posting: 1 = חובה, 2 = זכות. The stored amount
 *  keeps its own sign, so a negative credit stays a credit (a correction, not a
 *  debit) and the net is always debit − credit. */
const LEDGER_FIELDS = [
  ['account', 0, 11, 'LSTRING'],
  ['doc_date', 11, 2, 'DATE'],
  ['pay_date', 18, 2, 'DATE'],
  ['reg_date', 25, 2, 'DATE'],
  ['counter_account', 29, 11, 'LSTRING'],
  ['ref2', 40, 10, 'LSTRING'],
  ['ref1', 58, 10, 'LSTRING'], // Y-number of the source document
  ['order_num', 68, 7, 'LSTRING'],
  ['order_line', 75, 4, 'UINT32'],
  ['div_code', 85, 5, 'LSTRING'],
  ['dc_flag', 90, 1, 'UINT8'],
  ['amount', 91, 10, 'EXTENDED'],
  ['amount_fc', 101, 10, 'EXTENDED'],
  ['amount_ils', 121, 10, 'EXTENDED'],
  ['detail', 151, 31, 'LSTRING'],
  ['account2', 186, 21, 'LSTRING'],
  ['rec_type', 208, 1, 'UINT8'],
  ['paid', 226, 10, 'EXTENDED'], // settled so far (open-item)
  ['sequence', 249, 2, 'UINT16'],
] as const satisfies readonly Field[]

export const LAYOUTS = {
  /** Accounts — customers, suppliers and general-ledger cards all live here. */
  '7ACC': {
    file: '7ACC.DAT',
    recordLength: 374,
    fields: [
      ['flag', 0, 1, 'UINT8'],
      ['code', 1, 11, 'LSTRING'],
      ['class_code', 12, 6, 'LSTRING'], // קוד מאזן
      ['name', 19, 26, 'LSTRING'],
      ['address', 46, 26, 'LSTRING'],
      ['city', 73, 16, 'LSTRING'],
      ['contact', 90, 16, 'LSTRING'],
      ['phone', 106, 12, 'LSTRING'],
      ['tax_id', 118, 10, 'LSTRING'],
      ['credit_days', 128, 5, 'LSTRING'],
      ['currency', 134, 3, 'LSTRING'],
      ['group', 143, 3, 'LSTRING'],
      ['agent', 146, 3, 'LSTRING'],
    ],
  },

  '7UPD': { file: '7UPD.DAT', recordLength: 257, fields: LEDGER_FIELDS },
  /** VAT movements — the same record shape as the ledger. */
  '7MAM': { file: '7MAM.DAT', recordLength: 257, fields: LEDGER_FIELDS },

  /** Receipt headers (קופה). Every receipt reconciles against its 7KBL lines. */
  '7KBH': {
    file: '7KBH.DAT',
    recordLength: 280,
    fields: [
      ['format', 0, 3, 'LSTRING'],
      ['number', 3, 7, 'LSTRING'],
      ['account', 11, 11, 'LSTRING'],
      ['date', 22, 2, 'DATE'],
      ['name', 30, 26, 'LSTRING'],
      ['address', 56, 26, 'LSTRING'],
      ['city', 82, 16, 'LSTRING'],
      ['zip', 98, 6, 'LSTRING'],
      ['phone', 104, 12, 'LSTRING'],
      ['amount', 147, 10, 'EXTENDED'],
      ['signer', 168, 16, 'LSTRING'],
      ['time', 185, 9, 'LSTRING'],
    ],
  },

  /** Receipt payment lines — one per tender (cash, cheque, card, transfer). */
  '7KBL': {
    file: '7KBL.DAT',
    recordLength: 210,
    fields: [
      ['format', 0, 3, 'LSTRING'],
      ['number', 3, 7, 'LSTRING'],
      ['line', 10, 4, 'UINT32'],
      ['account', 14, 11, 'LSTRING'],
      ['pay_type', 25, 3, 'LSTRING'],
      ['due_date', 28, 2, 'DATE'],
      ['branch', 35, 7, 'LSTRING'],
      ['reference', 42, 17, 'LSTRING'], // cheque or (masked) card number
      ['bank', 59, 3, 'LSTRING'],
      ['amount', 77, 10, 'EXTENDED'],
      ['deposit_account', 100, 11, 'LSTRING'],
      ['deposit_ref', 111, 7, 'LSTRING'],
    ],
  },

  /** Bank statement lines, one file per bank account (300/305/320/325). */
  '7BNK': {
    file: '7BNK{acct}.DAT',
    recordLength: 80,
    fields: [
      ['page', 0, 5, 'LSTRING'],
      ['date', 9, 2, 'DATE'],
      ['value_date', 16, 2, 'DATE'],
      ['reference', 23, 7, 'LSTRING'],
      ['line_text', 30, 16, 'LSTRING'],
      ['kind', 45, 3, 'LSTRING'],
      ['amount', 49, 10, 'EXTENDED'],
      ['balance', 59, 10, 'EXTENDED'],
      ['detail', 70, 10, 'LSTRING'],
    ],
  },

  /** Cheques on hand / deposited, per bank account. */
  '7NOT': {
    file: '7NOT{acct}.DAT',
    recordLength: 90,
    fields: [
      ['number', 0, 7, 'LSTRING'],
      ['date', 11, 2, 'DATE'],
      ['due_date', 18, 2, 'DATE'],
      ['reference', 25, 7, 'LSTRING'],
      ['amount', 33, 10, 'EXTENDED'],
      ['line_text', 43, 15, 'LSTRING'],
      ['account', 59, 11, 'LSTRING'],
      ['detail', 71, 11, 'LSTRING'],
      ['code', 82, 4, 'LSTRING'],
    ],
  },

  /** Bank payments / deposits, per bank account. */
  '7YES': {
    file: '7YES{acct}.DAT',
    recordLength: 81,
    fields: [
      ['page', 0, 7, 'LSTRING'],
      ['date', 11, 2, 'DATE'],
      ['value_date', 18, 2, 'DATE'],
      ['reference', 25, 7, 'LSTRING'],
      ['amount', 33, 10, 'EXTENDED'],
      ['account', 46, 11, 'LSTRING'],
      ['detail', 61, 11, 'LSTRING'],
      ['code', 72, 4, 'LSTRING'],
    ],
  },

  /** Cheque / payment-order headers (חתימה על הוראות תשלום). */
  '7CHH': {
    file: '7CHH.DAT',
    recordLength: 292,
    fields: [
      ['bank', 0, 4, 'LSTRING'],
      ['number', 4, 7, 'LSTRING'],
      ['account', 12, 11, 'LSTRING'],
      ['name', 24, 26, 'LSTRING'],
      ['address', 51, 26, 'LSTRING'],
      ['city', 78, 16, 'LSTRING'],
      ['zip', 94, 6, 'LSTRING'],
      ['amount', 130, 10, 'EXTENDED'],
      ['date', 152, 2, 'DATE'],
      ['due_date', 159, 2, 'DATE'],
      ['detail', 204, 31, 'LSTRING'],
    ],
  },
} as const satisfies Record<string, TableLayout>

export type TableKey = keyof typeof LAYOUTS

/** The bank accounts that have their own per-account files. */
export const BANK_ACCOUNTS = ['300', '305', '320', '325'] as const

/** Every file the books load, in extraction order. */
export const BOOKS_TABLES: string[] = [
  '7ACC', '7UPD', '7MAM', '7KBH', '7KBL', '7CHH',
  ...BANK_ACCOUNTS.flatMap((a) => [`7BNK${a}`, `7NOT${a}`, `7YES${a}`]),
]

/** Layout key for a file name — the per-account files share one layout. */
export function layoutKeyFor(table: string): TableKey {
  const prefix = table.slice(0, 4)
  if (prefix === '7BNK' || prefix === '7NOT' || prefix === '7YES') return prefix as TableKey
  return table as TableKey
}
