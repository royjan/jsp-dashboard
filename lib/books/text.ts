/**
 * Visual-order → reading-order repair for Finansit text.
 *
 * The ERP stores Hebrew the way a DOS-era screen showed it: the Hebrew letters
 * sit in reading order, but Latin/digit runs inside them were typed
 * right-to-left and are stored backwards, and paired brackets are mirrored.
 * Reading the bytes as-is reproduces what the ERP's own screens show — not what
 * the text means.
 *
 * Measured against the 4,699 accounts the web bookkeeping system holds:
 *
 *  - Text containing Hebrew — reversing each Latin/digit run is right on 4,474
 *    of 4,588 names (97.5%), against 3,262 if left alone.
 *  - Text with no Hebrew at all (93 foreign suppliers) — the record may be
 *    stored fully reversed (`SROTOM TAYYAHK-LA` = `AL-KHAYYAT MOTORS`) or not,
 *    and nothing in the record says which. Looking for company words in each
 *    direction is right on 62 of 93; the rest are names like `ARMO`/`OMRA`
 *    that read as a word either way.
 */

const HEBREW = /[֐-׿]/
const LATIN_RUN = /[A-Za-z0-9][A-Za-z0-9.,'\-/&+:]*/g
const MIRROR: Record<string, string> = {
  '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<',
}

/** Words that appear in supplier names; used only to pick a direction for text
 *  that has no Hebrew to anchor it. */
const COMPANY_WORDS = new Set(
  `AUTO MOTORS PARTS SAS SA SL SRL GMBH LTD LIMITED CO COMPANY GROUP TRADING
   IMPORT EXPORT INTERNATIONAL COMERCIAL COMMERCIAL INDUSTRIES SPARE EUROPE
   FRANCE ITALIA ESPANA TURKEY CHINA TECH GLOBAL SUPPLY LOGISTICS BV NV AG SPA
   OY AB AS PLC INC LLC DIESEL TRUCK CAR AUTOMOTIVE`.split(/\s+/),
)

const mirror = (s: string) => s.replace(/[()[\]{}<>]/g, (c) => MIRROR[c] ?? c)
const reverse = (s: string) => mirror([...s].reverse().join(''))

function companyHits(s: string): number {
  return (s.toUpperCase().match(/[A-Z]{2,}/g) ?? []).filter((w) => COMPANY_WORDS.has(w)).length
}

/** Return `s` in reading order. Hebrew-only and empty text is unchanged. */
export function visualToLogical(s: string | null | undefined): string {
  if (!s) return ''
  LATIN_RUN.lastIndex = 0
  if (!LATIN_RUN.test(s)) return s
  if (HEBREW.test(s)) {
    LATIN_RUN.lastIndex = 0
    return mirror(s.replace(LATIN_RUN, (run) => [...run].reverse().join('')))
  }
  const reversed = reverse(s)
  const hitsStored = companyHits(s)
  const hitsReversed = companyHits(reversed)
  if (hitsReversed !== hitsStored) return hitsReversed > hitsStored ? reversed : s
  return reversed
}
