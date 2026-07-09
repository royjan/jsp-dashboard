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
  'קורת', 'כנפיים', 'מגש', 'טנק',
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

export function classifySize(name: string): ShipSize {
  if (!name) return 'medium'
  for (const kw of LARGE) if (name.includes(kw)) return 'large'
  for (const kw of MEDIUM) if (name.includes(kw)) return 'medium'
  for (const kw of SMALL) if (name.includes(kw)) return 'small'
  return 'medium' // unknown → conservative default
}

export const SIZE_FACTOR: Record<ShipSize, number> = { small: 1.0, medium: 0.55, large: 0.12 }

// Transparent 0–100 match score: value 35% + shipping-ease 30% + demand 20% + stock 15%.
export function matchScore(price: number, size: ShipSize, demand: number, stock: number): number {
  const val = Math.min(price / 15000, 1)
  const ship = SIZE_FACTOR[size]
  const dem = Math.min(demand / 40, 1)
  const stk = Math.min(stock / 15, 1)
  return Math.round(100 * (0.35 * val + 0.30 * ship + 0.20 * dem + 0.15 * stk))
}
