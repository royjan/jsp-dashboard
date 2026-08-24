/**
 * Reading the books.
 *
 * Every screen in הנהח״ש comes from here. Two rules hold throughout, both
 * learned elsewhere in this dashboard:
 *
 *  1. **Filtering, sorting, paging and totals all happen in SQL.** The KPI
 *     figures beside a table cover the whole filtered set, never the page that
 *     happens to be loaded — /stock-forecast once ranked a 200-row slice and
 *     reported "200 critical items" no matter how many there were.
 *  2. **Sort keys are whitelisted, never interpolated.** A sort parameter maps
 *     to a fixed SQL expression or falls back to the default.
 *
 * Reads go through `query()` with fully-qualified `books.*` — not
 * `readQueryAsync`, whose compatibility shim rewrites `?` placeholders and
 * prefixes bare table names with `dashboard.`.
 */

import { query } from '@/lib/db'
import { getCached, setCache } from '@/lib/redis-client'

export const BOOKS_PAGE_SIZE = 200

/** Reference prefixes: one letter for the document kind, then its ERP format. */
export const SALE_PREFIXES = ['D11', 'D13', 'D19'] as const
export const PURCHASE_PREFIXES = ['D51', 'D52', 'D53', 'D58', 'D59', 'D61', 'D62'] as const
export const CUSTOMER_CLASSES = ['2111', '2114', '2122'] as const
export const SUPPLIER_CLASSES = ['431', '432'] as const

/** The VAT accounts, as the ERP posts them. */
export const VAT_INPUT_ACCOUNT = '18001'   // מע"מ תשומות
export const VAT_OUTPUT_ACCOUNT = '18002'  // מע"מ עסקאות

export interface BooksScope {
  year: number
  from: string
  to: string
  q?: string
  sort?: string
  dir?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface BooksYear {
  year: number
  state: 'closed' | 'live'
  loaded_at: string | null
  refreshed_at: string | null
  ledger_rows: number
  /** True when the live year's watermark has aged past the refresh interval. */
  stale?: boolean
}

export interface Paged<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
  summary?: Record<string, number>
}

/** How long a view may be cached. A closed year cannot change; the live year
 *  is refreshed from the ERP every few minutes, so its cache is short. */
function ttlFor(year: number, live: number): number {
  return year === live ? 120 : 86_400
}

function orderBy(sort: string | undefined, dir: string | undefined,
                 columns: Record<string, string>, fallback: string): string {
  const column = columns[sort ?? ''] ?? columns[fallback] ?? fallback
  return `ORDER BY ${column} ${dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`
}

function paging(scope: BooksScope) {
  const pageSize = Math.min(scope.pageSize ?? BOOKS_PAGE_SIZE, 1000)
  const page = Math.max(1, scope.page ?? 1)
  return { pageSize, page, offset: (page - 1) * pageSize }
}

/**
 * When a year's data last moved — part of every cache key for that year.
 *
 * A refresh bumps `refreshed_at`, so every cached view of that year gets a new
 * key and the stale ones expire on their own. Deleting keys instead would mean
 * knowing every date-window a user has looked at.
 */
async function yearStamp(year: number): Promise<string> {
  const { rows } = await query(
    `SELECT EXTRACT(EPOCH FROM refreshed_at)::bigint AS stamp
     FROM books.years WHERE year = $1`, [year])
  return String(rows[0]?.stamp ?? '0')
}

async function cached<T>(key: string, year: number, live: number,
                         compute: () => Promise<T>): Promise<T> {
  const versioned = `${key}:${await yearStamp(year)}`
  const hit = await getCached<T>(versioned)
  if (hit) return hit
  const value = await compute()
  await setCache(versioned, value, ttlFor(year, live))
  return value
}

// ── years ─────────────────────────────────────────────────────────────── //

/** Every fiscal year the books hold, newest first. */
export async function getBooksYears(): Promise<BooksYear[]> {
  const { rows } = await query(
    `SELECT year, state, loaded_at, refreshed_at, ledger_rows
     FROM books.years ORDER BY year DESC`,
  )
  const now = Date.now()
  return rows.map((r: any) => ({
    ...r,
    year: Number(r.year),
    ledger_rows: Number(r.ledger_rows ?? 0),
    // A live year whose watermark has not moved in three hours means the
    // refresh loop stopped — the UI says so rather than presenting old numbers
    // as current.
    stale: r.state === 'live' && r.refreshed_at
      ? now - new Date(r.refreshed_at).getTime() > 3 * 3_600_000
      : r.state === 'live',
  }))
}

export async function getLiveYear(): Promise<number> {
  const { rows } = await query(`SELECT year FROM books.years WHERE state = 'live'
                                ORDER BY year DESC LIMIT 1`)
  if (rows[0]?.year) return Number(rows[0].year)
  const { rows: any } = await query(`SELECT MAX(year) AS year FROM books.years`)
  return Number(any[0]?.year ?? new Date().getFullYear())
}

/** Year-over-year totals — a full-ledger aggregate, so it is asked for only by
 *  the שנים screen, never by the year picker in the section header. */
export async function getYearTotals() {
  const { rows } = await query(
    `SELECT l.year,
            COUNT(*)::int                                          AS movements,
            ROUND(SUM(l.debit), 2)                                 AS debit,
            ROUND(SUM(l.credit), 2)                                AS credit,
            ROUND(SUM(CASE WHEN substr(l.ref1,1,3) = ANY($1) THEN l.credit END), 2) AS sales,
            ROUND(SUM(CASE WHEN substr(l.ref1,1,3) = ANY($2) THEN l.debit  END), 2) AS purchases,
            ROUND(SUM(CASE WHEN substr(l.ref1,1,1) = 'K'   THEN l.credit END), 2) AS receipts
     FROM books.ledger l WHERE l.source = 'ledger'
     GROUP BY l.year ORDER BY l.year`,
    [SALE_PREFIXES, PURCHASE_PREFIXES],
  )
  return rows
}

// ── overview ──────────────────────────────────────────────────────────── //

export async function getBooksOverview(scope: BooksScope, live: number) {
  const key = `books:overview:v1:${scope.year}:${scope.from}:${scope.to}`
  return cached(key, scope.year, live, async () => {
    const args = [scope.year, scope.from, scope.to]

    const [totals, monthly, vat, cash, debtors, creditors, top] = await Promise.all([
      query(`SELECT COUNT(*)::int AS movements, ROUND(SUM(debit),2) AS debit,
                    ROUND(SUM(credit),2) AS credit
             FROM books.ledger
             WHERE year=$1 AND source='ledger' AND doc_date BETWEEN $2 AND $3`, args),

      query(`SELECT to_char(date_trunc('month', doc_date), 'YYYY-MM') AS month,
                    ROUND(SUM(CASE WHEN substr(ref1,1,3) = ANY($4) THEN credit END),2) AS sales,
                    ROUND(SUM(CASE WHEN substr(ref1,1,3) = ANY($5) THEN debit  END),2) AS purchases,
                    ROUND(SUM(CASE WHEN substr(ref1,1,1) = 'K'    THEN credit END),2) AS receipts,
                    ROUND(SUM(debit),2)  AS debit,
                    ROUND(SUM(credit),2) AS credit
             FROM books.ledger
             WHERE year=$1 AND source='ledger' AND doc_date BETWEEN $2 AND $3
             GROUP BY 1 ORDER BY 1`, [...args, SALE_PREFIXES, PURCHASE_PREFIXES]),

      query(`SELECT ROUND(SUM(CASE WHEN account=$4 THEN credit-debit END),2) AS vat_out,
                    ROUND(SUM(CASE WHEN account=$5 THEN debit-credit END),2) AS vat_in
             FROM books.ledger
             WHERE year=$1 AND source='vat' AND doc_date BETWEEN $2 AND $3`,
        [...args, VAT_OUTPUT_ACCOUNT, VAT_INPUT_ACCOUNT]),

      query(`SELECT COUNT(*)::int AS count, ROUND(COALESCE(SUM(amount),0),2) AS total
             FROM books.receipts WHERE year=$1 AND date BETWEEN $2 AND $3`, args),

      query(`SELECT COUNT(*)::int AS count, ROUND(COALESCE(SUM(balance),0),2) AS total FROM (
               SELECT l.account, SUM(l.debit)-SUM(l.credit) AS balance
               FROM books.ledger l
               JOIN books.accounts a ON a.year=l.year AND a.code=l.account
               WHERE l.year=$1 AND l.source='ledger' AND a.class_code = ANY($2)
               GROUP BY l.account HAVING SUM(l.debit)-SUM(l.credit) > 0.5) d`,
        [scope.year, CUSTOMER_CLASSES]),

      query(`SELECT COUNT(*)::int AS count, ROUND(COALESCE(SUM(balance),0),2) AS total FROM (
               SELECT l.account, SUM(l.credit)-SUM(l.debit) AS balance
               FROM books.ledger l
               JOIN books.accounts a ON a.year=l.year AND a.code=l.account
               WHERE l.year=$1 AND l.source='ledger' AND a.class_code = ANY($2)
               GROUP BY l.account HAVING SUM(l.credit)-SUM(l.debit) > 0.5) c`,
        [scope.year, SUPPLIER_CLASSES]),

      query(`SELECT l.account, COALESCE(a.name,'') AS name, a.class_code,
                    ROUND(SUM(l.debit)-SUM(l.credit),2) AS balance, COUNT(*)::int AS movements
             FROM books.ledger l
             LEFT JOIN books.accounts a ON a.year=l.year AND a.code=l.account
             WHERE l.year=$1 AND l.source='ledger' AND l.doc_date BETWEEN $2 AND $3
             GROUP BY l.account, a.name, a.class_code
             ORDER BY ABS(SUM(l.debit)-SUM(l.credit)) DESC LIMIT 12`, args),
    ])

    const vatOut = Number(vat.rows[0]?.vat_out ?? 0)
    const vatIn = Number(vat.rows[0]?.vat_in ?? 0)
    return {
      totals: totals.rows[0],
      monthly: monthly.rows,
      vat: { out: vatOut, in: vatIn, due: Math.round((vatOut - vatIn) * 100) / 100 },
      cash: cash.rows[0],
      debtors: debtors.rows[0],
      creditors: creditors.rows[0],
      topAccounts: top.rows,
    }
  })
}

// ── accounts ──────────────────────────────────────────────────────────── //

const ACCOUNT_SORTS: Record<string, string> = {
  code: `CAST(NULLIF(regexp_replace(a.code, '\\D', '', 'g'), '') AS BIGINT)`,
  name: 'a.name', class: 'a.class_code', city: 'a.city',
  movements: 'COALESCE(l.movements,0)',
  debit: 'COALESCE(l.debit,0)',
  credit: 'COALESCE(l.credit,0)',
  balance: 'ABS(COALESCE(l.debit,0) - COALESCE(l.credit,0))',
}

export async function getAccounts(scope: BooksScope & { classCode?: string },
                                  live?: number): Promise<Paged<any>> {
  if (live !== undefined) {
    const key = `books:accounts:v1:${scope.year}:${scope.from}:${scope.to}:`
      + `${scope.q ?? ''}:${scope.classCode ?? ''}:${scope.sort ?? ''}:${scope.dir}:${scope.page ?? 1}`
    return cached(key, scope.year, live, () => getAccounts(scope))
  }
  const { pageSize, page, offset } = paging(scope)
  const where: string[] = ['a.year = $1']
  const args: unknown[] = [scope.year, scope.from, scope.to]
  if (scope.q) {
    args.push(`%${scope.q}%`)
    where.push(`(a.code ILIKE $${args.length} OR a.name ILIKE $${args.length}
                 OR a.tax_id ILIKE $${args.length})`)
  }
  if (scope.classCode) {
    args.push(scope.classCode)
    where.push(`a.class_code = $${args.length}`)
  }

  const base = `
    FROM books.accounts a
    LEFT JOIN (
      SELECT account, SUM(debit) AS debit, SUM(credit) AS credit, COUNT(*)::int AS movements
      FROM books.ledger
      WHERE year = $1 AND source = 'ledger' AND doc_date BETWEEN $2 AND $3
      GROUP BY account
    ) l ON l.account = a.code
    WHERE ${where.join(' AND ')}`

  // COUNT(*) OVER() rides along with the page instead of a second identical
  // aggregate: the join is over every account in the year, and paying for it
  // twice was most of this screen's latency.
  const rows = await query(
    `SELECT a.code, a.name, a.class_code, a.city, a.phone, a.tax_id,
            COALESCE(l.debit,0)  AS debit,
            COALESCE(l.credit,0) AS credit,
            COALESCE(l.movements,0) AS movements,
            COALESCE(l.debit,0) - COALESCE(l.credit,0) AS balance,
            COUNT(*) OVER()::int AS total_rows
     ${base}
     ${orderBy(scope.sort, scope.dir, ACCOUNT_SORTS, 'balance')}
     LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
    [...args, pageSize, offset],
  )
  const total = rows.rows[0]?.total_rows ?? 0
  return { rows: rows.rows, total, page, pageSize } as Paged<any>
}

/** The class codes present in a year, for the filter dropdown. */
export async function getAccountClasses(year: number) {
  const { rows } = await query(
    `SELECT class_code, COUNT(*)::int AS n FROM books.accounts
     WHERE year = $1 AND class_code <> '' GROUP BY 1 ORDER BY n DESC LIMIT 40`,
    [year],
  )
  return rows
}

// ── ledger card (כרטסת) ───────────────────────────────────────────────── //

export async function getLedgerCard(rawCode: string, scope: BooksScope) {
  // The books key accounts bare; the ERP and the dashboard pad them to ten
  // digits. Accept either, so a link from /customers/0000032505 lands here.
  const code = String(rawCode ?? '').trim().replace(/^0+/, '') || rawCode
  const args: unknown[] = [scope.year, code, scope.from, scope.to]
  let filter = ''
  if (scope.q) {
    args.push(`%${scope.q}%`)
    filter = ` AND (detail ILIKE $${args.length} OR ref1 ILIKE $${args.length})`
  }

  const { pageSize, page, offset } = paging(scope)

  const [account, opening, totals, movements] = await Promise.all([
    query(`SELECT * FROM books.accounts WHERE year=$1 AND code=$2`, [scope.year, code]),
    // Anything before the window folds into an opening balance, so the running
    // balance on screen is the account's real balance, not the window's.
    query(
      `SELECT ROUND(COALESCE(SUM(debit)-SUM(credit),0),2) AS opening
       FROM books.ledger
       WHERE year=$1 AND source='ledger' AND account=$2 AND doc_date < $3`,
      [scope.year, code, scope.from]),
    query(
      `SELECT COUNT(*)::int AS movements, ROUND(COALESCE(SUM(debit),0),2) AS debit,
              ROUND(COALESCE(SUM(credit),0),2) AS credit
       FROM books.ledger l
       WHERE l.year=$1 AND l.source='ledger' AND l.account=$2
         AND l.doc_date BETWEEN $3 AND $4${filter}`, args),
    // The running balance is a window function over the whole filtered set, so
    // a later page still starts where the previous one ended — carrying it in
    // the page's own rows would restart the balance at every page.
    query(
      `WITH ordered AS (
         SELECT l.*, COALESCE(a.name,'') AS counter_name, a.class_code AS counter_class,
                SUM(l.debit - l.credit) OVER (ORDER BY l.doc_date, l.sequence
                                              ROWS UNBOUNDED PRECEDING) AS running
         FROM books.ledger l
         LEFT JOIN books.accounts a ON a.year=l.year AND a.code=l.counter_account
         WHERE l.year=$1 AND l.source='ledger' AND l.account=$2
           AND l.doc_date BETWEEN $3 AND $4${filter}
       )
       SELECT * FROM ordered ORDER BY doc_date, sequence
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, pageSize, offset]),
  ])

  const openingBalance = Number(opening.rows[0]?.opening ?? 0)
  const rows = movements.rows.map((r: any) => ({
    ...r,
    balance: Math.round((openingBalance + Number(r.running ?? 0)) * 100) / 100,
  }))
  const t = totals.rows[0]

  return {
    account: account.rows[0] ?? null,
    opening: openingBalance,
    rows,
    total: t.movements,
    page,
    pageSize,
    summary: {
      debit: Number(t.debit),
      credit: Number(t.credit),
      balance: Math.round((openingBalance + Number(t.debit) - Number(t.credit)) * 100) / 100,
      movements: t.movements,
    },
  }
}

// ── trial balance (מאזן בוחן) ─────────────────────────────────────────── //

const TRIAL_SORTS: Record<string, string> = {
  code: `CAST(NULLIF(regexp_replace(l.account, '\\D', '', 'g'), '') AS BIGINT)`,
  name: 'a.name', class: 'a.class_code', movements: 'COUNT(*)',
  debit: 'SUM(l.debit)', credit: 'SUM(l.credit)',
  balance: 'ABS(SUM(l.debit) - SUM(l.credit))',
}

export async function getTrialBalance(scope: BooksScope & { includeZero?: boolean },
                                      live?: number): Promise<Paged<any>> {
  if (live !== undefined) {
    const key = `books:trial:v1:${scope.year}:${scope.from}:${scope.to}:${scope.q ?? ''}:`
      + `${scope.includeZero ? 1 : 0}:${scope.sort ?? ''}:${scope.dir}:${scope.page ?? 1}`
    return cached(key, scope.year, live, () => getTrialBalance(scope))
  }
  const { pageSize, page, offset } = paging(scope)
  const args: unknown[] = [scope.year, scope.from, scope.to]
  let filter = ''
  if (scope.q) {
    args.push(`%${scope.q}%`)
    filter = ` AND (l.account ILIKE $${args.length} OR a.name ILIKE $${args.length})`
  }
  const having = scope.includeZero ? '' : 'HAVING ABS(SUM(l.debit) - SUM(l.credit)) >= 0.005'

  const base = `
    FROM books.ledger l
    LEFT JOIN books.accounts a ON a.year = l.year AND a.code = l.account
    WHERE l.year=$1 AND l.source='ledger' AND l.doc_date BETWEEN $2 AND $3${filter}
    GROUP BY l.account, a.name, a.class_code
    ${having}`

  const [summary, rows] = await Promise.all([
    query(`SELECT COUNT(*)::int AS accounts, ROUND(COALESCE(SUM(debit),0),2) AS debit,
                  ROUND(COALESCE(SUM(credit),0),2) AS credit
           FROM (SELECT SUM(l.debit) AS debit, SUM(l.credit) AS credit ${base}) t`, args),
    // (the row query below is the second pass; the summary above is what the
    // KPI line reports over the WHOLE filtered set, never the page)
    query(
      `SELECT l.account, COALESCE(a.name,'') AS name, a.class_code,
              COUNT(*)::int AS movements,
              ROUND(SUM(l.debit),2)  AS debit,
              ROUND(SUM(l.credit),2) AS credit,
              ROUND(SUM(l.debit) - SUM(l.credit),2) AS balance
       ${base}
       ${orderBy(scope.sort, scope.dir, TRIAL_SORTS, 'balance')}
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, pageSize, offset],
    ),
  ])

  const s = summary.rows[0]
  return {
    rows: rows.rows,
    total: s.accounts,
    page,
    pageSize,
    summary: {
      accounts: s.accounts,
      debit: Number(s.debit),
      credit: Number(s.credit),
      diff: Math.round((Number(s.debit) - Number(s.credit)) * 100) / 100,
    },
  } as Paged<any>
}

// ── journal (פקודות יומן) ─────────────────────────────────────────────── //

const JOURNAL_SORTS: Record<string, string> = {
  date: 'MIN(doc_date)', ref: 'ref1', lines: 'COUNT(*)',
  debit: 'SUM(debit)', credit: 'SUM(credit)',
}

export async function getJournal(scope: BooksScope & { kind?: string }) {
  const { pageSize, page, offset } = paging(scope)
  const args: unknown[] = [scope.year, scope.from, scope.to]
  const where: string[] = []
  if (scope.q) {
    args.push(`%${scope.q}%`)
    where.push(`(detail ILIKE $${args.length} OR ref1 ILIKE $${args.length}
                 OR order_num ILIKE $${args.length})`)
  }
  if (scope.kind) {
    args.push(scope.kind)
    where.push(`substr(ref1,1,3) = $${args.length}`)
  }
  const filter = where.length ? ` AND ${where.join(' AND ')}` : ''
  const base = `
    FROM books.ledger
    WHERE year=$1 AND source='ledger' AND doc_date BETWEEN $2 AND $3${filter}
    GROUP BY ref1, order_num`

  const [count, rows] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n FROM (SELECT 1 ${base}) t`, args),
    query(
      `SELECT ref1, order_num, MIN(doc_date) AS date, COUNT(*)::int AS lines,
              ROUND(SUM(debit),2) AS debit, ROUND(SUM(credit),2) AS credit,
              MIN(detail) AS detail
       ${base}
       ${orderBy(scope.sort, scope.dir, JOURNAL_SORTS, 'date')}, ref1 DESC
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, pageSize, offset],
    ),
  ])
  return { rows: rows.rows, total: count.rows[0].n, page, pageSize } as Paged<any>
}

/** The document kinds present in a year, with counts, for the filter. */
export async function getJournalKinds(year: number) {
  const { rows } = await query(
    `SELECT substr(ref1,1,3) AS kind, COUNT(*)::int AS movements,
            COUNT(DISTINCT ref1)::int AS documents
     FROM books.ledger WHERE year=$1 AND source='ledger' AND ref1 <> ''
     GROUP BY 1 ORDER BY movements DESC`, [year],
  )
  return rows
}

/** One reference: its postings, and the VAT movements that accompany it. */
export async function getJournalEntry(ref: string, year: number) {
  const [lines, vat] = await Promise.all([
    query(
      `SELECT l.*, COALESCE(a.name,'') AS account_name, a.class_code,
              COALESCE(c.name,'') AS counter_name, c.class_code AS counter_class
       FROM books.ledger l
       LEFT JOIN books.accounts a ON a.year=l.year AND a.code=l.account
       LEFT JOIN books.accounts c ON c.year=l.year AND c.code=l.counter_account
       WHERE l.year=$1 AND l.source='ledger' AND l.ref1=$2
       ORDER BY l.order_line, l.sequence`, [year, ref]),
    query(
      `SELECT l.*, COALESCE(a.name,'') AS account_name
       FROM books.ledger l
       LEFT JOIN books.accounts a ON a.year=l.year AND a.code=l.account
       WHERE l.year=$1 AND l.source='vat' AND l.ref1=$2 ORDER BY l.sequence`, [year, ref]),
  ])
  const debit = lines.rows.reduce((s: number, r: any) => s + Number(r.debit ?? 0), 0)
  const credit = lines.rows.reduce((s: number, r: any) => s + Number(r.credit ?? 0), 0)
  return {
    ref,
    lines: lines.rows,
    vat: vat.rows,
    summary: {
      lines: lines.rows.length,
      debit: Math.round(debit * 100) / 100,
      credit: Math.round(credit * 100) / 100,
      balanced: Math.abs(debit - credit) < 0.005,
    },
  }
}

// ── VAT (מע"מ) ────────────────────────────────────────────────────────── //

export async function getVatReport(scope: BooksScope, live: number) {
  const key = `books:vat:v1:${scope.year}:${scope.from}:${scope.to}`
  return cached(key, scope.year, live, async () => {
    const args = [scope.year, scope.from, scope.to, VAT_INPUT_ACCOUNT, VAT_OUTPUT_ACCOUNT]
    const [monthly, byAccount] = await Promise.all([
      query(
        `SELECT to_char(date_trunc('month', doc_date), 'YYYY-MM') AS month,
                COUNT(*)::int AS movements,
                ROUND(SUM(CASE WHEN account=$5 THEN credit-debit END),2) AS vat_out,
                ROUND(SUM(CASE WHEN account=$4 THEN debit-credit END),2) AS vat_in,
                ROUND(SUM(CASE WHEN account NOT IN ($4,$5) THEN credit-debit END),2) AS turnover
         FROM books.ledger
         WHERE year=$1 AND source='vat' AND doc_date BETWEEN $2 AND $3
         GROUP BY 1 ORDER BY 1`, args),
      query(
        `SELECT l.account, COALESCE(a.name,'') AS name, COUNT(*)::int AS movements,
                ROUND(SUM(l.debit),2) AS debit, ROUND(SUM(l.credit),2) AS credit
         FROM books.ledger l
         LEFT JOIN books.accounts a ON a.year=l.year AND a.code=l.account
         WHERE l.year=$1 AND l.source='vat' AND l.doc_date BETWEEN $2 AND $3
         GROUP BY l.account, a.name
         ORDER BY SUM(l.debit)+SUM(l.credit) DESC`, [scope.year, scope.from, scope.to]),
    ])
    const months = monthly.rows.map((m: any) => ({
      ...m,
      due: Math.round((Number(m.vat_out ?? 0) - Number(m.vat_in ?? 0)) * 100) / 100,
    }))
    const sum = (k: string) => Math.round(
      months.reduce((s: number, m: any) => s + Number(m[k] ?? 0), 0) * 100) / 100
    return {
      months,
      byAccount: byAccount.rows,
      summary: {
        turnover: sum('turnover'), vat_out: sum('vat_out'),
        vat_in: sum('vat_in'), due: sum('due'),
      },
    }
  })
}

// ── cash (קופה) ───────────────────────────────────────────────────────── //

const RECEIPT_SORTS: Record<string, string> = {
  number: 'r.number', date: 'r.date', account: 'r.account', name: 'r.name',
  amount: 'r.amount', lines: 'lines',
}

export async function getReceipts(scope: BooksScope, live?: number): Promise<any> {
  if (live !== undefined) {
    const key = `books:receipts:v1:${scope.year}:${scope.from}:${scope.to}:`
      + `${scope.q ?? ''}:${scope.sort ?? ''}:${scope.dir}:${scope.page ?? 1}`
    return cached(key, scope.year, live, () => getReceipts(scope))
  }
  const { pageSize, page, offset } = paging(scope)
  const args: unknown[] = [scope.year, scope.from, scope.to]
  let filter = ''
  if (scope.q) {
    args.push(`%${scope.q}%`)
    filter = ` AND (r.number ILIKE $${args.length} OR r.name ILIKE $${args.length}
                    OR r.account ILIKE $${args.length})`
  }
  const base = `FROM books.receipts r WHERE r.year=$1 AND r.date BETWEEN $2 AND $3${filter}`

  const [summary, rows, mix, monthly] = await Promise.all([
    query(`SELECT COUNT(*)::int AS count, ROUND(COALESCE(SUM(r.amount),0),2) AS total ${base}`, args),
    query(
      `SELECT r.*, (SELECT COUNT(*)::int FROM books.receipt_lines l
                    WHERE l.year=r.year AND l.number=r.number) AS lines
       ${base} ${orderBy(scope.sort, scope.dir, RECEIPT_SORTS, 'date')}
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, pageSize, offset]),
    query(
      `SELECT l.pay_type, COUNT(*)::int AS count, ROUND(SUM(l.amount),2) AS total
       FROM books.receipt_lines l JOIN books.receipts r
         ON r.year=l.year AND r.number=l.number
       WHERE l.year=$1 AND r.date BETWEEN $2 AND $3
       GROUP BY 1 ORDER BY total DESC`, [scope.year, scope.from, scope.to]),
    query(
      `SELECT to_char(date_trunc('month', r.date), 'YYYY-MM') AS month,
              COUNT(*)::int AS count, ROUND(SUM(r.amount),2) AS total
       FROM books.receipts r WHERE r.year=$1 AND r.date BETWEEN $2 AND $3
       GROUP BY 1 ORDER BY 1`, [scope.year, scope.from, scope.to]),
  ])

  return {
    rows: rows.rows, total: summary.rows[0].count, page, pageSize,
    summary: { count: summary.rows[0].count, total: Number(summary.rows[0].total) },
    mix: mix.rows, monthly: monthly.rows,
  }
}

export async function getReceipt(number: string, year: number) {
  const [header, lines, posted] = await Promise.all([
    query(`SELECT * FROM books.receipts WHERE year=$1 AND number=$2`, [year, number]),
    query(`SELECT * FROM books.receipt_lines WHERE year=$1 AND number=$2 ORDER BY line`,
      [year, number]),
    query(
      `SELECT l.*, COALESCE(a.name,'') AS account_name
       FROM books.ledger l
       LEFT JOIN books.accounts a ON a.year=l.year AND a.code=l.account
       WHERE l.year=$1 AND l.source='ledger'
         AND l.ref1 = 'K' || (SELECT format FROM books.receipts WHERE year=$1 AND number=$2) || $2
       ORDER BY l.sequence`, [year, number]),
  ])
  return { receipt: header.rows[0] ?? null, lines: lines.rows, posted: posted.rows }
}

/** The four bank-side lists share a shape: filter by date, sort, page. */
export async function getCashTable(
  table: 'bank_lines' | 'cheques' | 'bank_payments' | 'payment_orders',
  scope: BooksScope & { bankAccount?: string },
  live?: number,
): Promise<any> {
  if (live !== undefined) {
    const key = `books:cash-table:v1:${table}:${scope.year}:${scope.from}:${scope.to}:`
      + `${scope.bankAccount ?? ''}:${scope.q ?? ''}:${scope.sort ?? ''}:${scope.dir}:${scope.page ?? 1}`
    return cached(key, scope.year, live, () => getCashTable(table, scope))
  }
  const dateColumn = table === 'cheques' ? 'due_date' : 'date'
  // bank_lines is raw bank-statement lines: no counter-account column at all.
  const hasAccount = table !== 'bank_lines'
  const { pageSize, page, offset } = paging(scope)
  const args: unknown[] = [scope.year, scope.from, scope.to]
  const where = [`t.year=$1`, `t.${dateColumn} BETWEEN $2 AND $3`]
  if (scope.bankAccount && table !== 'payment_orders') {
    args.push(scope.bankAccount)
    where.push(`t.bank_account = $${args.length}`)
  }
  if (scope.q) {
    args.push(`%${scope.q}%`)
    where.push(hasAccount
      ? `(t.detail ILIKE $${args.length} OR t.account ILIKE $${args.length})`
      : `t.detail ILIKE $${args.length}`)
  }
  const sorts: Record<string, string> = {
    date: `t.${dateColumn}`, amount: 't.amount',
    reference: 't.reference', detail: 't.detail',
    ...(hasAccount ? { account: 't.account' } : {}),
  }
  const from = `FROM books.${table} t`
  const whereClause = `WHERE ${where.join(' AND ')}`
  const joinName = hasAccount && table !== 'payment_orders' ?
    `LEFT JOIN books.accounts a ON a.year=t.year AND a.code=t.account` : ''
  const nameColumn = table === 'payment_orders' ? `t.name AS account_name`
    : hasAccount ? `COALESCE(a.name,'') AS account_name`
    : `NULL::text AS account_name`

  const [summary, rows] = await Promise.all([
    query(`SELECT COUNT(*)::int AS count, ROUND(COALESCE(SUM(t.amount),0),2) AS total
           ${from} ${whereClause}`, args),
    query(`SELECT t.*, ${nameColumn} ${from} ${joinName} ${whereClause}
           ${orderBy(scope.sort, scope.dir, sorts, 'date')}
           LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, pageSize, offset]),
  ])
  return {
    rows: rows.rows, total: summary.rows[0].count, page, pageSize,
    summary: { count: summary.rows[0].count, total: Number(summary.rows[0].total) },
  }
}

/** Which bank accounts a year has statements for. */
export async function getBankAccounts(year: number) {
  const { rows } = await query(
    `SELECT bank_account, COUNT(*)::int AS lines FROM books.bank_lines
     WHERE year=$1 GROUP BY 1 ORDER BY 1`, [year])
  return rows
}

/** Cheques still to clear, for the timeline on the cash screen. */
export async function getUpcomingCheques(year: number, limit = 60) {
  const { rows } = await query(
    `SELECT c.due_date, c.amount, c.account, c.detail, COALESCE(a.name,'') AS account_name
     FROM books.cheques c
     LEFT JOIN books.accounts a ON a.year=c.year AND a.code=c.account
     WHERE c.year=$1 AND c.due_date >= CURRENT_DATE
     ORDER BY c.due_date LIMIT $2`, [year, limit])
  return rows
}

// ── purchasing (רכש) ──────────────────────────────────────────────────── //

export async function getPurchasing(scope: BooksScope & { kind?: string },
                                    live?: number): Promise<any> {
  if (live !== undefined) {
    const key = `books:purchasing:v1:${scope.year}:${scope.from}:${scope.to}:`
      + `${scope.kind ?? ''}:${scope.q ?? ''}:${scope.sort ?? ''}:${scope.dir}:${scope.page ?? 1}`
    return cached(key, scope.year, live, () => getPurchasing(scope))
  }
  const { pageSize, page, offset } = paging(scope)
  const args: unknown[] = [scope.year, scope.from, scope.to, PURCHASE_PREFIXES]
  const where = [`year=$1`, `source='ledger'`, `doc_date BETWEEN $2 AND $3`,
    `substr(ref1,1,3) = ANY($4)`]
  if (scope.kind) {
    args.push(scope.kind)
    where.push(`substr(ref1,1,3) = $${args.length}`)
  }
  if (scope.q) {
    args.push(`%${scope.q}%`)
    where.push(`(detail ILIKE $${args.length} OR ref1 ILIKE $${args.length})`)
  }
  const base = `FROM books.ledger WHERE ${where.join(' AND ')} GROUP BY ref1`
  const sorts: Record<string, string> = {
    date: 'MIN(doc_date)', ref: 'ref1', lines: 'COUNT(*)',
    debit: 'SUM(debit)', credit: 'SUM(credit)',
  }

  const [count, rows, byKind, monthly] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n FROM (SELECT 1 ${base}) t`, args),
    query(
      // The supplier is the account carrying the document's largest credit —
      // picked inside the same aggregation rather than by a correlated
      // subquery, which cannot see the grouped row's year.
      `SELECT ref1, MIN(doc_date) AS date, MIN(detail) AS detail, COUNT(*)::int AS lines,
              ROUND(SUM(debit),2) AS debit, ROUND(SUM(credit),2) AS credit,
              (array_agg(account ORDER BY credit DESC)
               FILTER (WHERE credit > 0))[1] AS supplier
       ${base} ${orderBy(scope.sort, scope.dir, sorts, 'date')}
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, pageSize, offset]),
    // The type tiles ignore the type filter — they are how you switch between
    // types, so they must keep showing what the other types hold.
    query(
      `SELECT substr(ref1,1,3) AS kind, COUNT(DISTINCT ref1)::int AS documents,
              ROUND(SUM(debit),2) AS debit
       FROM books.ledger
       WHERE year=$1 AND source='ledger' AND doc_date BETWEEN $2 AND $3
         AND substr(ref1,1,3) = ANY($4)
       GROUP BY 1 ORDER BY debit DESC`, [scope.year, scope.from, scope.to, PURCHASE_PREFIXES]),
    query(
      `SELECT to_char(date_trunc('month', doc_date), 'YYYY-MM') AS month,
              ROUND(SUM(debit),2) AS purchases, COUNT(DISTINCT ref1)::int AS documents
       FROM books.ledger
       WHERE year=$1 AND source='ledger' AND doc_date BETWEEN $2 AND $3
         AND substr(ref1,1,3) = ANY($4)
       GROUP BY 1 ORDER BY 1`, [scope.year, scope.from, scope.to, PURCHASE_PREFIXES]),
  ])

  return {
    rows: rows.rows, total: count.rows[0].n, page, pageSize,
    byKind: byKind.rows, monthly: monthly.rows,
  }
}

export async function getBookSuppliers(scope: BooksScope, live?: number): Promise<any> {
  if (live !== undefined) {
    const key = `books:suppliers:v1:${scope.year}:${scope.from}:${scope.to}:`
      + `${scope.q ?? ''}:${scope.sort ?? ''}:${scope.dir}:${scope.page ?? 1}`
    return cached(key, scope.year, live, () => getBookSuppliers(scope))
  }
  const { pageSize, page, offset } = paging(scope)
  const args: unknown[] = [scope.year, scope.from, scope.to, SUPPLIER_CLASSES]
  let filter = ''
  if (scope.q) {
    args.push(`%${scope.q}%`)
    filter = ` AND (a.name ILIKE $${args.length} OR a.code ILIKE $${args.length})`
  }
  const base = `
    FROM books.ledger l
    JOIN books.accounts a ON a.year=l.year AND a.code=l.account
    WHERE l.year=$1 AND l.source='ledger' AND l.doc_date BETWEEN $2 AND $3
      AND a.class_code = ANY($4)${filter}
    GROUP BY a.code, a.name, a.city, a.phone`
  const sorts: Record<string, string> = {
    code: 'a.code', name: 'a.name', movements: 'COUNT(*)', last: 'MAX(l.doc_date)',
    debit: 'SUM(l.debit)', credit: 'SUM(l.credit)',
    balance: 'SUM(l.credit) - SUM(l.debit)',
  }

  const [count, rows] = await Promise.all([
    query(`SELECT COUNT(*)::int AS n FROM (SELECT 1 ${base}) t`, args),
    query(
      `SELECT a.code, a.name, a.city, a.phone, COUNT(*)::int AS movements,
              MAX(l.doc_date) AS last_movement,
              ROUND(SUM(l.debit),2)  AS debit,
              ROUND(SUM(l.credit),2) AS credit,
              ROUND(SUM(l.credit) - SUM(l.debit),2) AS balance
       ${base} ${orderBy(scope.sort, scope.dir, sorts, 'balance')}
       LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, pageSize, offset]),
  ])
  return { rows: rows.rows, total: count.rows[0].n, page, pageSize } as Paged<any>
}

// ── search (⌘K and the account picker) ────────────────────────────────── //

export async function searchBooks(term: string, year: number, limit = 12) {
  if (!term || term.trim().length < 2) return []
  const like = `%${term.trim()}%`
  const [accounts, refs, receipts] = await Promise.all([
    query(`SELECT code, name, class_code FROM books.accounts
           WHERE year=$1 AND (code ILIKE $2 OR name ILIKE $2)
           ORDER BY length(name) LIMIT $3`, [year, like, limit]),
    query(`SELECT DISTINCT ref1 FROM books.ledger
           WHERE year=$1 AND source='ledger' AND ref1 ILIKE $2 LIMIT 6`, [year, like]),
    query(`SELECT number, name, amount FROM books.receipts
           WHERE year=$1 AND (number ILIKE $2 OR name ILIKE $2) LIMIT 6`, [year, like]),
  ])
  return [
    ...accounts.rows.map((r: any) => ({ kind: 'account' as const, ...r })),
    ...refs.rows.map((r: any) => ({ kind: 'ref' as const, ref: r.ref1 })),
    ...receipts.rows.map((r: any) => ({ kind: 'receipt' as const, ...r })),
  ]
}
