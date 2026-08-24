import { NextResponse } from 'next/server'
import { initializeSecrets, getSecret } from '@/lib/aws-secrets'
import { generateTextWithFallback } from '@/lib/gemini'
import { getCached, setCache } from '@/lib/redis-client'
import { query } from '@/lib/db'
import { getLiveYear } from '@/lib/services/books-service'
import { booksError, parseScope } from '@/lib/books/scope'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** A week: the analysis describes a fixed window, so it does not go off.
 *  'נתח שוב' (refresh=1) is what regenerates it. */
const CACHE_TTL = 7 * 24 * 3600

const SYSTEM = `אתה רואה חשבון ותיק שקורא את הספרים של חברה ישראלית לחלקי חילוף.
אתה מקבל נתונים מצטברים מתוך ספרי החברה — לא מסמכים בודדים.

כתוב בעברית, ענייני ותכליתי, בלי שבחים ובלי מילוי.
מבנה התשובה:
1. שורה תחתונה — 2-3 משפטים: מה מצב העסק בטווח הזה.
2. מה בולט — 3-5 נקודות. כל נקודה נשענת על מספר מהנתונים, וכותבת אותו.
3. מה כדאי לבדוק — 2-4 נקודות פעולה קונקרטיות, לפי סדר חשיבות.

כללים:
- אל תמציא מספרים. אם נתון חסר, אמור שהוא חסר.
- הבחן בין מה שהנתונים מראים לבין פרשנות שלך.
- מע"מ, גבייה ותזרים חשובים יותר מגודל המחזור.
- אם משהו נראה כמו טעות רישום ולא כמו מצב עסקי — אמור זאת.`

/**
 * The factual brief: aggregates only, never raw postings — small enough for the
 * model to read in one pass, and nothing in it identifies a single document.
 */
async function collect(year: number, from: string, to: string) {
  const window = [year, from, to]
  const [summary, monthly, vat, debtors, creditors, mix, cheques, banks, years] =
    await Promise.all([
      query(`SELECT COUNT(*)::int AS movements, ROUND(SUM(debit),2) AS debit,
                    ROUND(SUM(credit),2) AS credit FROM books.ledger
             WHERE year=$1 AND source='ledger' AND doc_date BETWEEN $2 AND $3`, window),
      query(`SELECT to_char(date_trunc('month', doc_date),'YYYY-MM') AS month,
                    ROUND(SUM(CASE WHEN substr(ref1,1,3) IN ('D11','D13','D19')
                                   THEN credit END),0) AS sales,
                    ROUND(SUM(CASE WHEN substr(ref1,1,3) IN ('D51','D52','D58','D59')
                                   THEN debit END),0) AS purchases,
                    ROUND(SUM(CASE WHEN substr(ref1,1,1)='K' THEN credit END),0) AS receipts
             FROM books.ledger WHERE year=$1 AND source='ledger' AND doc_date BETWEEN $2 AND $3
             GROUP BY 1 ORDER BY 1`, window),
      query(`SELECT to_char(date_trunc('month', doc_date),'YYYY-MM') AS month,
                    ROUND(SUM(CASE WHEN account='18002' THEN credit-debit END),0) AS vat_out,
                    ROUND(SUM(CASE WHEN account='18001' THEN debit-credit END),0) AS vat_in
             FROM books.ledger WHERE year=$1 AND source='vat' AND doc_date BETWEEN $2 AND $3
             GROUP BY 1 ORDER BY 1`, window),
      query(`SELECT a.name, l.account, ROUND(SUM(l.debit)-SUM(l.credit),0) AS balance,
                    MAX(l.doc_date) AS last_movement
             FROM books.ledger l JOIN books.accounts a ON a.year=l.year AND a.code=l.account
             WHERE l.year=$1 AND l.source='ledger' AND l.doc_date BETWEEN $2 AND $3
               AND a.class_code IN ('2111','2114','2122')
             GROUP BY a.name, l.account HAVING SUM(l.debit)-SUM(l.credit) > 0
             ORDER BY 3 DESC LIMIT 12`, window),
      query(`SELECT a.name, l.account, ROUND(SUM(l.credit)-SUM(l.debit),0) AS balance
             FROM books.ledger l JOIN books.accounts a ON a.year=l.year AND a.code=l.account
             WHERE l.year=$1 AND l.source='ledger' AND l.doc_date BETWEEN $2 AND $3
               AND a.class_code IN ('431','432')
             GROUP BY a.name, l.account HAVING SUM(l.credit)-SUM(l.debit) > 0
             ORDER BY 3 DESC LIMIT 10`, window),
      query(`SELECT l.pay_type, COUNT(*)::int AS count, ROUND(SUM(l.amount),0) AS total
             FROM books.receipt_lines l JOIN books.receipts r
               ON r.year=l.year AND r.number=l.number
             WHERE l.year=$1 AND r.date BETWEEN $2 AND $3 GROUP BY 1 ORDER BY 3 DESC`, window),
      query(`SELECT COUNT(*)::int AS count, ROUND(SUM(amount),0) AS total,
                    MIN(due_date) AS first_due, MAX(due_date) AS last_due
             FROM books.cheques WHERE year=$1 AND due_date >= CURRENT_DATE`, [year]),
      query(`SELECT bank_account, ROUND(balance,0) AS balance, date FROM books.bank_lines b
             WHERE year=$1 AND date = (SELECT MAX(date) FROM books.bank_lines x
                                       WHERE x.year=b.year AND x.bank_account=b.bank_account)
             GROUP BY bank_account, balance, date`, [year]),
      query(`SELECT year, ROUND(SUM(CASE WHEN substr(ref1,1,3) IN ('D11','D13','D19')
                                         THEN credit END),0) AS sales,
                    ROUND(SUM(CASE WHEN substr(ref1,1,1)='K' THEN credit END),0) AS receipts
             FROM books.ledger WHERE source='ledger' AND year <> $1
             GROUP BY year ORDER BY year`, [year]),
    ])

  return {
    שנה: year,
    טווח: `${from} עד ${to}`,
    סיכום: summary.rows[0],
    לפי_חודש: monthly.rows,
    מעמ_לפי_חודש: vat.rows,
    חייבים_גדולים: debtors.rows,
    ספקים_גדולים: creditors.rows,
    אמצעי_תשלום: mix.rows,
    שיקים_עתידיים: cheques.rows[0],
    יתרות_בנק: banks.rows,
    שנים_קודמות: years.rows,
  }
}

/** Hebrew sanity gate — a model that answers in English, or opens with JSON,
 *  is a failed answer, not content to render. */
function looksUsable(text: string): boolean {
  if (!text || text.trim().length < 80) return false
  if (/^[{[]/.test(text.trim())) return false
  const hebrew = (text.match(/[֐-׿]/g) ?? []).length
  return hebrew > text.length * 0.2
}

export async function GET(request: Request) {
  try {
    await initializeSecrets()
    if (!getSecret('GEMINI_API_KEY')) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY לא מוגדר — הניתוח אינו זמין' }, { status: 503 })
    }
    const live = await getLiveYear()
    const scope = parseScope(new URL(request.url), live)
    const refresh = scope.extras.get('refresh') === '1'
    const cacheKey = `books:insights:v1:${scope.year}:${scope.from}:${scope.to}`

    const cached = refresh ? null : await getCached<any>(cacheKey)
    if (cached) return NextResponse.json({ ...cached, cached: true })

    const facts = await collect(scope.year, scope.from, scope.to)
    const movements = Number((facts.סיכום as any)?.movements ?? 0)
    if (!movements) {
      // No movements in a window that should have them means the loader
      // stopped, not a quiet quarter — say so, and never cache it.
      return NextResponse.json(
        { error: 'אין תנועות בטווח הזה — ייתכן שהטעינה מה-ERP נעצרה' }, { status: 409 })
    }

    const { text } = await generateTextWithFallback({
      system: SYSTEM,
      prompt: 'להלן נתונים מצטברים מתוך ספרי החברה (בשקלים, חיובי = חובה, שלילי = זכות):\n\n'
        + JSON.stringify(facts, null, 1) + '\n\nקרא אותם וכתוב את הניתוח.',
      temperature: 0.3,
    } as Parameters<typeof generateTextWithFallback>[0])

    if (!looksUsable(text)) {
      return NextResponse.json({ error: 'הניתוח חזר ריק או לא בעברית — נסה שוב' },
                               { status: 502 })
    }
    const payload = {
      text: text.trim(),
      window: { year: scope.year, from: scope.from, to: scope.to },
      generated_at: new Date().toISOString(),
    }
    await setCache(cacheKey, payload, CACHE_TTL)
    return NextResponse.json(payload)
  } catch (e) {
    return NextResponse.json(booksError(e), { status: 500 })
  }
}
