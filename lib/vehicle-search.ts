/**
 * Forgiving search over Hebrew vehicle names (gov.il spells every brand in Hebrew only).
 *
 * Three ways a reasonable query used to find nothing:
 *  1. English — "tesla" vs "טסלה". BRAND_EN gives each gov.il brand its Latin names.
 *  2. Spelling — "פגו" / "פיגו" / "פיג׳ו" / "פיג'ו". Hebrew is written with or without
 *     the vowel letters י/ו and with any of four apostrophes, so both sides are folded to
 *     a skeleton without them before comparing.
 *  3. Keyboard layout — "tesla" typed on a Hebrew layout arrives as "אקדךש". Each query is
 *     also tried through the layout swap in both directions.
 */

/** gov.il `tozar` -> Latin names. Keys are exactly as gov.il spells them. */
export const BRAND_EN: Record<string, string> = {
  'טויוטה': 'toyota', 'יונדאי': 'hyundai', 'קיה': 'kia', 'מזדה': 'mazda', 'סקודה': 'skoda',
  'מיצובישי': 'mitsubishi', 'סוזוקי': 'suzuki', 'ניסאן': 'nissan', 'סיאט': 'seat',
  'פולקסווגן': 'volkswagen vw', 'רנו': 'renault', 'הונדה': 'honda', 'שברולט': 'chevrolet',
  'סובארו': 'subaru', 'סיטרואן': 'citroen', "צ'רי": 'chery', "פיג'ו": 'peugeot', 'פורד': 'ford',
  'בי ווי די': 'byd', 'מרצדס': 'mercedes benz', 'מרצדס בנץ': 'mercedes benz', 'ב מ וו': 'bmw',
  "ג'אקו": 'jaecoo', 'מ.ג': 'mg', 'אאודי': 'audi', 'אודי': 'audi', 'טסלה': 'tesla', 'אופל': 'opel',
  'איסוזו': 'isuzu', 'גילי': 'geely', "דאצ'יה": 'dacia', 'דאציה': 'dacia', 'מרוטי סוזוקי': 'maruti suzuki',
  'וולבו': 'volvo', 'פיאט': 'fiat', 'לקסוס': 'lexus', 'דייהטסו': 'daihatsu', 'אקספנג': 'xpeng',
  'קרייזלר': 'chrysler', "ג'יפ": 'jeep', 'לינק אנד קו': 'lynk & co', 'אלפא רומיאו': 'alfa romeo',
  'זיקר': 'zeekr', 'קאדילאק': 'cadillac', 'רובר': 'rover', 'דיפאל': 'deepal', 'סרס': 'seres',
  'קיי גי מוביליט': 'kg mobility', 'סאנגיונג': 'ssangyong', 'אומודה': 'omoda', 'אורה': 'ora',
  'לנדרובר': 'land rover', 'דיימלר קרייזלר': 'daimler chrysler', 'ליפמוטור': 'leapmotor',
  'מקסוס': 'maxus', 'קופרה': 'cupra', 'סמארט': 'smart', 'דונגפנג': 'dongfeng', 'פורשה': 'porsche',
  'ביואיק': 'buick', 'סקיוול': 'skywell', 'איווייס': 'aiways', 'איויאיסי': 'evec',
  'אף אי דאבל יו': 'faw', 'וויה': 'voyah', 'יגואר': 'jaguar', 'פורתינג': 'forthing',
  "פיאג'ו": 'piaggio', 'גי.אי.סי': 'gac', 'די אס': 'ds', 'וואי': 'wey', 'פוטון': 'foton',
  "ג'אק": 'jac', 'איון': 'aion', 'פולסטאר': 'polestar', "ג'יי איי סי": 'jac', 'מזארטי': 'maserati',
  'אוואטר': 'avatr', 'ניאו רכב': 'nio', 'איי אם': 'im', "ג'י.אמ.סי": 'gmc', "לנצ'יה": 'lancia',
  'בנטלי': 'bentley', 'פרארי': 'ferrari', 'האמר ג.מ': 'hummer gmc', 'האמר': 'hummer',
  'באייק': 'baic', "דודג'": 'dodge', 'סאאב': 'saab', 'אסטון מרטין': 'aston martin',
  'גרייט וול': 'great wall gwm', 'ארקפוקס': 'arcfox', 'דאבל יו אם איי': 'wm motor',
  'אל אי וי סי': 'levc', 'מאן': 'man', 'אלפין': 'alpine', 'למבורגיני': 'lamborghini',
  'אס דאבל יו אמ': 'swm', 'די.אף.אס.קיי': 'dfsk', 'דייהו': 'daewoo', "ג'יי.אמ.סי": 'jmc',
  'רולס רויס': 'rolls royce', 'איווקו': 'iveco', 'אמ.סי.סי': 'mcc', 'לוטוס': 'lotus',
  'לינקולן': 'lincoln', 'מיני': 'mini', 'אינאוס': 'ineos', 'מורגן': 'morgan',
}

const FINALS: Record<string, string> = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' }

/** Lower-case, apostrophes/dots/dashes out, Hebrew finals regularised, י/ו dropped. */
export function fold(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[ךםןףץ]/g, c => FINALS[c])
    .replace(/[֑-ׇ]/g, '') // niqqud / cantillation
    .replace(/['"`׳״.\-_]/g, '')
    .replace(/[יו]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Standard Israeli layout, one key per position.
const EN_KEYS = "qwertyuiopasdfghjkl;'zxcvbnm,./"
const HE_KEYS = "/'קראטוןםפשדגכעיחלךף,זסבהנמצתץ."
const EN2HE = new Map([...EN_KEYS].map((c, i) => [c, HE_KEYS[i]]))
const HE2EN = new Map([...HE_KEYS].map((c, i) => [c, EN_KEYS[i]]))

/** The text as it would have come out on the other keyboard layout. */
export function swapLayout(s: string): string {
  const lower = s.toLowerCase()
  const toHe = /[a-z]/.test(lower) && !/[א-ת]/.test(lower)
  const map = toHe ? EN2HE : HE2EN
  return [...lower].map(c => map.get(c) ?? c).join('')
}

/** Searchable text for a brand: Hebrew name plus its Latin names. */
export const brandHay = (brand: string) => `${brand} ${BRAND_EN[brand] ?? ''}`

/**
 * A predicate over already-FOLDED haystacks. Returns null for an empty query
 * (match everything). Every word must appear somewhere ("tesla model 3",
 * "פיגו 208"). The layout-swapped variant only counts when it is at least three
 * characters, so a stray 2-letter swap does not light up half the fleet.
 */
export function makeMatcher(query: string): ((foldedHay: string) => boolean) | null {
  const q = query.trim()
  if (!q) return null
  const variants = [fold(q)]
  const swapped = fold(swapLayout(q))
  if (swapped.length >= 3 && swapped !== variants[0]) variants.push(swapped)
  const live = variants.map(v => v.split(' ').filter(Boolean)).filter(t => t.length)
  if (!live.length) return null
  return hay => live.some(words => words.every(w => has(hay, w)))
}

/**
 * Hebrew words match anywhere (folding already blurs their edges, and a brand is
 * often glued to a prefix). Latin and digits match from the start of a word, so
 * "mg" finds MG and not every Mercedes "AMG", and "3" finds MODEL 3, not 308.
 */
function has(hay: string, w: string): boolean {
  if (/[\u05D0-\u05EA]/.test(w)) return hay.includes(w)
  for (let i = hay.indexOf(w); i !== -1; i = hay.indexOf(w, i + 1)) {
    if (i === 0 || !/[a-z0-9]/.test(hay[i - 1])) return true
  }
  return false
}
