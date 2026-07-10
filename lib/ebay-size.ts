// Ship-size classification for eBay recommendations, from the Hebrew part name.
// small  = ships anywhere cheaply (sensors, injectors, valves, switches, ECUs)
// medium = manageable but heavier/bulkier (turbo, DPF, pump, catalytic, clutch)
// large  = bulky / impractical to ship abroad (doors, hoods, radiators, seats)
//
// Order matters: LARGE first (exclude), then MEDIUM (so a clutch kit or DPF
// isn't mislabeled "small" by an incidental keyword like מיסב/מסנן), then SMALL.

const LARGE = [
  'דלת', 'מכסה מנוע', 'בונט', 'כנף', 'פגוש', 'טמבון', 'גג', 'שמשה', 'זכוכית',
  'חלון', 'ספוילר', 'מיכל', 'רדיאטור', 'מעבה', 'ריפוד', 'מושב', 'דשבורד',
  'שלדה', 'סף רכב', 'פנס ראשי', 'פנס אחורי', 'מגן', 'גריל', 'דופן', 'ארגז',
  'קורת', 'כנפיים', 'מגש', 'טנק', 'פח',
]
const MEDIUM = [
  'מצמד', 'חלקיקים', 'זיהום אויר', 'ממיר', 'קטליט', 'טורבו', 'מש לחץ',
  'משאבת לחץ', 'גלגל תנופה', 'אלטרנטור', 'סטרטר', 'מנוע התנעה', 'קומפרסור',
  'מצנן', 'אינטרקולר', 'גיר', 'ראש מנוע', 'בית מצערת', 'מזגן', 'בולם', 'אגזוז',
  'מאוורר', 'דיסק', 'מחצית', 'ציריה', 'חצי סרן', 'זרוע', 'משאבת מים', 'מפוח',
  'גל זיזים', 'פלנשה', 'ואקום מגבר',
]
const SMALL = [
  'אינג', 'מזרק', 'דיזה', 'שסתום', 'חיישן', 'מתג', 'מפסק', 'ידית', 'נורה',
  'רלה', 'ממסר', 'אטם', 'בוכנה', 'סליל', 'הצתה', 'יחידת בקרה', 'מחשב', 'ECU',
  'מודול', 'מד ', 'ווסת', 'בית מתג', 'בית מסנן', 'מיסב', 'מסב', 'טבעת', 'גומי',
  'תושבת', 'מנעול', 'חיווט', 'נגד', 'ראש מזרק', 'בוקסה', 'טרמינל', 'צלב',
  'משאבת דלק', 'גלאי',
]

export type ShipSize = 'small' | 'medium' | 'large'

// A bare engine ("מנוע DV5", "מנוע 1500D") is too heavy/costly to ship abroad → large.
// But NOT engine sub-parts that merely contain מנוע (mount/starter/fan/head/cover),
// which are small/medium and ship fine.
const ENGINE_RE = /מנוע\s+(?:DV|DW|EP|EB|TU|EC|\d{3,4})/
const ENGINE_NOT = ['תושבת מנוע', 'מנוע התנעה', 'מנוע מאוורר', 'ראש מנוע', 'מכסה מנוע']

export function classifySize(name: string): ShipSize {
  if (!name) return 'medium'
  // standalone engine → large (unless it's an engine sub-part)
  if (ENGINE_RE.test(name) && !ENGINE_NOT.some(k => name.includes(k))) return 'large'
  for (const kw of LARGE) if (name.includes(kw)) return 'large'
  for (const kw of MEDIUM) if (name.includes(kw)) return 'medium'
  for (const kw of SMALL) if (name.includes(kw)) return 'small'
  return 'medium' // unknown → conservative default
}

export const SIZE_FACTOR: Record<ShipSize, number> = { small: 1.0, medium: 0.55, large: 0.12 }

// Years of inventory at the recent sales rate — the "dead stock" signal.
// High stock ÷ low recent sales = many years of stock = prime liquidation candidate.
// The 0.5 floor keeps zero-sellers finite (and maximally overstocked).
export function yearsOfStock(stock: number, sold2025: number, sold2024: number): number {
  const rate = (sold2025 + sold2024) / 2
  return stock / Math.max(rate, 0.5)
}

// Transparent 0–100 match score for eBay LIQUIDATION: overstock 45% + value 28% + ship 27%.
// eBay is a channel to clear dead/excess stock, so overstocked slow-movers score HIGH and
// healthy fast-movers score LOW (we keep those and sell locally at full margin).
export function matchScore(
  price: number, size: ShipSize, stock: number, sold2025: number, sold2024: number,
): number {
  const overstock = Math.min(yearsOfStock(stock, sold2025, sold2024) / 5, 1)
  const value = Math.min(price / 15000, 1)
  const ship = SIZE_FACTOR[size]
  return Math.round(100 * (0.45 * overstock + 0.28 * value + 0.27 * ship))
}
