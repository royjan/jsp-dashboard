/** Hebrew labels for the flow-decisions screens.
 *
 * The app is `<html lang="he" dir="rtl">` everywhere; these screens were the exception, built
 * in English inside an RTL document. That is worse than either choice on its own — the page
 * reads left-to-right while the shell around it reads right-to-left, and a Hebrew part
 * description dropped into an LTR table cell aligns to the wrong edge and collides with the
 * next column.
 *
 * VALUES STAY ENGLISH, LABELS BECOME HEBREW. `status`, `lambda_target` and `source` are
 * database values and query-string values; translating the value would break a bookmark and a
 * filter. So the map is display-only, and every lookup falls back to the raw value — a new
 * status appearing in the DB shows up as itself rather than as blank.
 */

const dict: Record<string, string> = {
  // status
  suggestion: 'הצעה',
  approved: 'מאושר',
  rejected: 'נדחה',
  pending: 'ממתין',
  // portals. `lambda_target` is the column name; "portal" is what people call it, and
  // 'partslink' is the column DEFAULT — a row that never named its portal, which no reader
  // consumes. Worth showing as itself so it is recognisable in the list.
  psa: 'PSA',
  saic: 'MG / SAIC',
  partslink: 'partslink (ללא ניתוב)',
  vin17: 'VIN17',
  qipei: 'Qipei',
  // source
  all: 'הכל',
  manual: 'ידני',
  learned: 'נלמד',
  'learned (pins)': 'נלמד (הצמדות)',
  any: 'כל',
  yes: 'יש',
  no: 'אין',
  'has filters': 'עם סינון',
  'no filters': 'ללא סינון',
}

export function he(value: string | null | undefined): string {
  const v = String(value ?? '').trim()
  return dict[v] ?? dict[v.toLowerCase()] ?? v
}

/** Fixed UI strings, grouped by where they appear. */
export const L = {
  title: 'החלטות ניתוב',
  rules: 'כללים',
  coverage: 'כיסוי',
  fullSimulator: 'סימולטור מלא',
  retroScan: 'סריקה למפרע',
  export: 'ייצוא',
  newRule: 'כלל חדש',
  matching: 'מתאימים',

  search: 'חיפוש לפי תיאור חלק, קטגוריה או שרטוט…',
  scope: 'תחולה',
  status: 'סטטוס',
  source: 'מקור',
  lambda: 'פורטל',
  vehicleFilters: 'סינון רכב',
  directPart: 'מק"ט ישיר',
  advanced: 'סינון מתקדם (שנה, דגם, דלק, מנוע, VIN)',
  yearFrom: 'משנה',
  yearTo: 'עד שנה',
  model: 'דגם',
  fuelType: 'סוג דלק',
  engineModel: 'דגם מנוע',
  vinPattern: 'תבנית VIN',

  colStatus: 'סטטוס',
  colPart: 'תיאור החלק',
  colLambda: 'פורטל',
  colRoute: 'קטגוריה / שרטוט',
  colVehicle: 'רכב',
  colActivity: 'פעילות',
  colDirect: 'ישיר',
  colUpdated: 'עודכן',
  colActions: 'פעולות',
  perPage: 'לעמוד',
  allRules: 'כל הכללים',

  coverageReport: 'דוח כיסוי',
  tracked: 'תיאורי חלקים במעקב',
  noRule: 'ללא כלל',
  onlyUncovered: 'הצג רק ללא כלל',
  usage: 'שימוש',
  hasRule: 'יש כלל',
  createRule: 'צור כלל',
  liveSimulator: 'סימולטור חי',
}
