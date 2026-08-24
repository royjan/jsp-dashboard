/**
 * The `books` schema DDL.
 *
 * The loader owns these tables, the way `ebay_uploader` is owned by the eBay
 * uploader — which is why `books` is deliberately NOT in drizzle.config.ts's
 * `schemaFilter`: `npm run db:push` must never be able to drop or alter them.
 *
 * Every row carries its fiscal year. Closed years are immutable once loaded;
 * the active year is merged on `fp`, a hash of the record's bytes, so a posting
 * that changes (an invoice being settled) arrives as a new fingerprint and
 * replaces its own row rather than duplicating it.
 */

export const BOOKS_DDL = `
CREATE SCHEMA IF NOT EXISTS books;

CREATE TABLE IF NOT EXISTS books.years (
  year          INTEGER PRIMARY KEY,
  state         TEXT NOT NULL,            -- 'closed' | 'live'
  loaded_at     TIMESTAMPTZ,
  refreshed_at  TIMESTAMPTZ,
  ledger_rows   INTEGER DEFAULT 0,
  source        TEXT
);

CREATE TABLE IF NOT EXISTS books.accounts (
  year        INTEGER NOT NULL,
  code        TEXT NOT NULL,
  name        TEXT,
  class_code  TEXT,
  city        TEXT,
  address     TEXT,
  phone       TEXT,
  tax_id      TEXT,
  credit_days TEXT,
  currency    TEXT,
  agent       TEXT,
  PRIMARY KEY (year, code)
);
CREATE INDEX IF NOT EXISTS accounts_class ON books.accounts (year, class_code);
CREATE INDEX IF NOT EXISTS accounts_name  ON books.accounts (year, name);

CREATE TABLE IF NOT EXISTS books.ledger (
  year            INTEGER NOT NULL,
  source          TEXT NOT NULL,          -- 'ledger' (7UPD) | 'vat' (7MAM)
  fp              TEXT NOT NULL,
  account         TEXT NOT NULL,
  counter_account TEXT,
  doc_date        DATE,
  pay_date        DATE,
  reg_date        DATE,
  ref1            TEXT,
  ref2            TEXT,
  order_num       TEXT,
  order_line      INTEGER,
  div_code        TEXT,
  amount          NUMERIC,                -- net: debit - credit
  debit           NUMERIC,                -- as posted (rec_type 1); can be negative
  credit          NUMERIC,                -- as posted (rec_type 2); can be negative
  paid            NUMERIC,
  detail          TEXT,
  rec_type        SMALLINT,
  sequence        INTEGER,
  PRIMARY KEY (year, source, fp)
);
CREATE INDEX IF NOT EXISTS ledger_account ON books.ledger (year, source, account, doc_date);
CREATE INDEX IF NOT EXISTS ledger_date    ON books.ledger (year, source, doc_date);
CREATE INDEX IF NOT EXISTS ledger_ref1    ON books.ledger (year, source, ref1);
CREATE INDEX IF NOT EXISTS ledger_kind    ON books.ledger (year, source, substr(ref1, 1, 3));
CREATE INDEX IF NOT EXISTS ledger_counter ON books.ledger (year, source, counter_account);

CREATE TABLE IF NOT EXISTS books.receipts (
  year    INTEGER NOT NULL,
  number  TEXT NOT NULL,
  format  TEXT,
  account TEXT,
  date    DATE,
  name    TEXT,
  city    TEXT,
  phone   TEXT,
  amount  NUMERIC,
  signer  TEXT,
  time    TEXT,
  PRIMARY KEY (year, number)
);
CREATE INDEX IF NOT EXISTS receipts_date    ON books.receipts (year, date);
CREATE INDEX IF NOT EXISTS receipts_account ON books.receipts (year, account);

CREATE TABLE IF NOT EXISTS books.receipt_lines (
  year            INTEGER NOT NULL,
  number          TEXT NOT NULL,
  line            INTEGER NOT NULL,
  account         TEXT,
  pay_type        TEXT,
  due_date        DATE,
  bank            TEXT,
  branch          TEXT,
  reference       TEXT,
  amount          NUMERIC,
  deposit_account TEXT,
  deposit_ref     TEXT,
  PRIMARY KEY (year, number, line)
);
CREATE INDEX IF NOT EXISTS receipt_lines_type ON books.receipt_lines (year, pay_type);

CREATE TABLE IF NOT EXISTS books.bank_lines (
  year         INTEGER NOT NULL,
  bank_account TEXT NOT NULL,
  fp           TEXT NOT NULL,
  page         TEXT,
  date         DATE,
  value_date   DATE,
  reference    TEXT,
  kind         TEXT,
  amount       NUMERIC,
  balance      NUMERIC,
  detail       TEXT,
  PRIMARY KEY (year, bank_account, fp)
);
CREATE INDEX IF NOT EXISTS bank_lines_date ON books.bank_lines (year, bank_account, date);

CREATE TABLE IF NOT EXISTS books.cheques (
  year         INTEGER NOT NULL,
  bank_account TEXT NOT NULL,
  fp           TEXT NOT NULL,
  number       TEXT,
  date         DATE,
  due_date     DATE,
  amount       NUMERIC,
  reference    TEXT,
  account      TEXT,
  detail       TEXT,
  code         TEXT,
  PRIMARY KEY (year, bank_account, fp)
);
CREATE INDEX IF NOT EXISTS cheques_due ON books.cheques (year, due_date);

CREATE TABLE IF NOT EXISTS books.bank_payments (
  year         INTEGER NOT NULL,
  bank_account TEXT NOT NULL,
  fp           TEXT NOT NULL,
  page         TEXT,
  date         DATE,
  value_date   DATE,
  amount       NUMERIC,
  reference    TEXT,
  account      TEXT,
  detail       TEXT,
  code         TEXT,
  PRIMARY KEY (year, bank_account, fp)
);
CREATE INDEX IF NOT EXISTS bank_payments_date ON books.bank_payments (year, bank_account, date);

CREATE TABLE IF NOT EXISTS books.payment_orders (
  year     INTEGER NOT NULL,
  fp       TEXT NOT NULL,
  number   TEXT,
  bank     TEXT,
  account  TEXT,
  name     TEXT,
  city     TEXT,
  amount   NUMERIC,
  date     DATE,
  due_date DATE,
  detail   TEXT,
  PRIMARY KEY (year, fp)
);
CREATE INDEX IF NOT EXISTS payment_orders_date ON books.payment_orders (year, date);
`
