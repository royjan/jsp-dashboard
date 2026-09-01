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

  // ── simulator ────────────────────────────────────────────────────────────────
  // The field used to say "Part description (English)". That was never true: `simulate()`
  // detects Hebrew, expands it through `word_mappings` (he → en canonical) and vector-searches
  // on the expansion — so a Hebrew ask has always worked. The label was turning a working
  // feature away.
  simPartDesc: 'תיאור החלק (עברית או אנגלית)',
  simPartPlaceholder: 'לדוגמה: פילטר שמן · oil filter',
  vinOptional: 'VIN (לא חובה)',
  result: 'תוצאה',
  matchType: 'סוג התאמה',
  simEmpty: 'הקלד תיאור חלק כדי לראות איזה כלל מנצח.',
  simNoMatch: 'לא נמצא כלל מתאים.',

  // ── retro-scan ───────────────────────────────────────────────────────────────
  retroTitle: 'הצעות מסריקה למפרע',
  retroBlurb: 'סורק את היסטוריית החיפושים האחרונה ומאתר בקשות לחלקים שעדיין אין להן כלל ניתוב. עברו על הניתובים המוצעים וצרו את אלה שתרצו.',
  daysBack: 'ימים אחורה',
  maxSuggestions: 'מקסימום הצעות',
  runScan: 'הרץ סריקה',
  retroIdle: 'הרץ סריקה כדי לראות הצעות.',
  retroScanning: 'סורק היסטוריית חיפושים…',
  retroEmpty: 'לא נמצאו הצעות חדשות בטווח שנסרק.',
  applySomeFailed: 'החלת חלק מההצעות נכשלה',
  seen: 'נצפה',
  filters: 'סינון',

  // ── VIN decode ───────────────────────────────────────────────────────────────
  vinDecodeOptional: 'פענוח VIN (לא חובה)',
  decode: 'פענח',
  decoded: 'פוענח',
  vehicleIdentified: 'הרכב זוהה',
  clear: 'נקה',

  // ── export ───────────────────────────────────────────────────────────────────
  exportTitle: 'ייצוא כללי ניתוב',
  exportFormat: 'פורמט ייצוא',
  exportOptions: 'אפשרויות ייצוא',
  fmtSql: 'ייבוא ישיר למסד הנתונים, כולל טיפול ב-ON CONFLICT',
  fmtJson: 'נתונים מובנים לייבוא תוכנתי',
  fmtCsv: 'פורמט תואם גיליון אלקטרוני',
  fmtPrisma: 'קובץ seed בטייפסקריפט עבור Prisma',
  includeMetadata: 'כלול מטא-דאטה',
  includeTimestamps: 'כלול חותמות זמן',

  cancel: 'ביטול',
  close: 'סגור',
  idCopied: 'המזהה הועתק',
  copyFailed: 'ההעתקה נכשלה',
  copyId: 'העתק מזהה',

  // ── list header / filter bar ─────────────────────────────────────────────────
  found: 'נמצא',
  filtered: 'מסונן',
  clearAll: 'נקה הכל',
  advancedFilters: 'סינון מתקדם (שנה, דגם, דלק, מנוע, VIN)',
  hasDirectPart: 'עם מק״ט',
  noDirectPart: 'ללא מק״ט',
  allNRules: (n: number) => `כל ${n} הכללים`,
  showingOf: (shown: number, total: number) => `מוצגים ${shown} מתוך ${total} כללים`,
  nSelected: (n: number) => (n === 1 ? 'נבחר אחד' : `${n} נבחרו`),
  showRelated: (n: number) => `הצג ${n} כללים קשורים עבור`,

  // ── rule editor ──────────────────────────────────────────────────────────────
  editRule: 'עריכת כלל',
  tabMatch: 'התאמה',
  tabAction: 'פעולה',
  tabHistory: 'היסטוריה',
  vehicleFiltersOptional: 'סינון לפי רכב (לא חובה)',
  decodeVinAutofill: 'פענח VIN למילוי אוטומטי',
  pinnedDirectPart: 'מק״ט מוצמד (לא חובה)',
  partNumber: 'מק״ט',
  partNameInSchema: 'שם החלק (כפי שמופיע בשרטוט)',
  inStock: 'במלאי',
  outOfStock: 'אזל מהמלאי',
  created: 'נוצר',
  approvedAt: 'אושר',
  rejectedAt: 'נדחה',
  rejectionReason: 'סיבת הדחייה',
  feedbackCount: 'מספר משובים',

  // ── create wizard ────────────────────────────────────────────────────────────
  stepPartTitle: 'איזה חלק הלקוח מבקש?',
  stepPartHint: 'כתבו את זה כמו שלקוח היה אומר — בעברית או באנגלית. אנחנו נתאים לקטלוג הנכון.',
  stepSupplierTitle: 'איפה לחפש אותו?',
  stepSupplierHint: 'בחרו את קטלוג הספק שמחזיק את החלק הזה עבור הרכבים האלה.',
  stepVehicleTitle: 'לאילו רכבים הכלל חל?',
  stepVehicleHint: 'השאירו על "כל הרכבים", אלא אם החלק מתאים רק לדגמים או לשנים מסוימות.',
  allVehicles: 'כל הרכבים',
  allVehiclesSub: 'חל על כל רכב',
  specificVehicles: 'רכבים מסוימים',
  specificVehiclesSub: 'הגבלה לפי דגם, שנה, דלק…',
  stepCatalogTitle: 'איפה החלק הזה יושב בקטלוג?',
  stepCatalogHint: (supplier: string) =>
    `הסבירו איך למצוא את החלק בתוך ${supplier} — או הדביקו מק״ט ותנו לנו למלא אוטומטית.`,
  stepReviewTitle: 'סקירת הכלל החדש',
  stepReviewHint: 'זה מה שעומד להיווצר. הריצו בדיקה חיה כדי לראות מה יקרה בפועל.',
  duplicateExists: 'כבר קיים כלל תואם',
  supplier: 'ספק',
  vehicles: 'רכבים',
  optional: 'לא חובה',

  // Hints and placeholders. The CATALOG ITSELF IS ENGLISH — PSA's tree really does read
  // `Mechanical › Engine - Lubrication › ENGINE OIL FILTER` — so the examples stay in the
  // language the field is actually filled in, with the instruction around them in Hebrew.
  hintCategory: 'הקבוצה הרחבה, למשל Engine, Brakes, Body.',
  hintSubcategory: 'קבוצה צרה יותר בתוך הקטגוריה, למשל Filters.',
  hintSchema: 'שם קבוצת החלקים / השרטוט המדויק בקטלוג.',
  hintPartName: 'איך החלק רשום בתוך השרטוט, למשל OIL SEPARATOR SEAL.',
  phPartDesc: 'לדוגמה: פילטר שמן · brake pad set',
  phFuel: 'בנזין, דיזל, חשמלי…',
  phModel: 'דגם או יצרן — 208, Peugeot…',
  phCategory: 'לדוגמה: Engine',
  phSubcategory: 'לדוגמה: Filters',
  phSchema: 'לדוגמה: ENGINE OIL FILTER',
  phPartName: 'לדוגמה: OIL SEPARATOR SEAL',
  phPartNumber: 'לדוגמה: 6466S5 — השאירו ריק ללא הצמדה',
  phLookupVin: 'VIN — נדרש רק לחלק שלא ראינו קודם (חיפוש חי, עד ~90 שניות)',

  /* Counted strings. Hebrew has no "1 suggestion / 2 suggestions" split the way English does —
     the noun stays plural from 2 up and the count sits before it — so these are written out
     rather than assembled from a stem plus an 's'. */
  considered: (n: number) => (n === 1 ? 'נבחן מועמד אחד' : `נבחנו ${n} מועמדים`),
  selectedOf: (sel: number, total: number) => `נבחרו ${sel} מתוך ${total}`,
  createSuggestions: (n: number) =>
    n === 0 ? 'צור הצעות' : n === 1 ? 'צור הצעה אחת' : `צור ${n} הצעות`,
}
