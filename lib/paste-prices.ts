/**
 * Parser for a price list pasted out of Excel, WhatsApp or an email.
 *
 * Ported from jan-portal (`src/lib/parsePastedPrices.ts`). Not every price list
 * arrives as a workbook: a supplier or a rep sends twenty lines in a message,
 * and until now the only way into this app was `.xlsx` through the competitor
 * uploader, which such a list is not worth building.
 *
 * A bad line never rejects the paste — it is skipped WITH A REASON, so the
 * preview can show what was dropped and why. Silently ignoring a malformed row
 * is how a price list quietly arrives 3 rows short.
 *
 * This deliberately does not import from `lib/competitors/parse-sheets.ts`
 * despite the overlap in intent: that module pulls in `xlsx` at the top level,
 * and this one runs in the browser.
 */

export interface ParsedPriceRow {
  /** As typed, for display — the paste is the user's own text. */
  rawCode: string
  /** Comparison form: upper-case, separators removed. */
  code: string
  price: number
  /** Anything after the price on the line (supplier, brand, "מקורי", …). */
  note?: string
}

export interface SkippedPriceRow {
  line: number
  text: string
  reason: string
}

export interface PastedPrices {
  rows: ParsedPriceRow[]
  skipped: SkippedPriceRow[]
}

/** Upper bound past which a "price" is a mis-parsed cell rather than an amount. */
const MAX_PRICE = 1_000_000

/**
 * Comparison form of an item code. Codes reach us spaced, dotted or hyphenated
 * depending on who typed them ('0249.E6', '9824 4878 ZD'), while both the ERP
 * and the portal store them bare, so the separators come out on both sides.
 */
export function normalizeCode(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/^ERP-/, '')
    .replace(/[^A-Z0-9]/g, '')
}

/** '29.00 ₪' / '1,022.50' → number; anything else → null. */
export function parsePastedMoney(raw: unknown): number | null {
  const n = Number(
    String(raw ?? '')
      .replace(/[₪$€,\s]/g, '')
      .replace(/[^\d.\-]/g, ''),
  )
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PRICE) return null
  return Math.round(n * 100) / 100
}

/**
 * Split one line into fields. Excel copies as TAB-separated; a message is more
 * likely to be spaces or a comma. TAB wins when present because a tabbed line
 * can legitimately contain spaces inside a name.
 */
function tokenize(line: string): string[] {
  if (line.includes('\t')) return line.split('\t')
  // A comma-separated line usually has a space after the comma too, so the
  // whitespace split wins and leaves the separator glued to the token:
  // "9833351080, 38" produced the code "9833351080," — normalised away for the
  // lookup, but shown to the user in the table exactly like that. Strip a
  // leading/trailing separator from each field rather than reordering the
  // rules, which would break "0249E6  52.60  מקורי".
  const strip = (t: string) => t.trim().replace(/^[,;]+|[,;]+$/g, '')
  if (line.split(/\s+/).length >= 2) return line.split(/\s+/).map(strip)
  return line.split(/[,;]/).map(strip)
}

/**
 * Parse pasted "code price [note]" lines. Later rows win on a repeated code —
 * a corrected line pasted below the original is the common case.
 */
export function parsePastedPrices(text: string): PastedPrices {
  const byCode = new Map<string, ParsedPriceRow>()
  const skipped: SkippedPriceRow[] = []

  String(text ?? '')
    .split(/\r?\n/)
    .forEach((rawLine, i) => {
      const line = rawLine.trim()
      if (!line) return

      const tokens = tokenize(line)
      const rawCode = String(tokens[0] ?? '').trim()
      const code = normalizeCode(rawCode)
      const price = parsePastedMoney(tokens[1])

      if (!code) {
        skipped.push({ line: i + 1, text: line, reason: 'חסר מק"ט' })
        return
      }
      // A header row ("מק\"ט  מחיר") parses as a code with no price; so does a
      // line where the price column landed third. Both are worth reporting.
      if (price === null) {
        skipped.push({ line: i + 1, text: line, reason: 'מחיר לא תקין' })
        return
      }

      const note = tokens.slice(2).join(' ').trim()
      byCode.set(code, { rawCode, code, price, ...(note ? { note } : {}) })
    })

  return { rows: [...byCode.values()], skipped }
}
