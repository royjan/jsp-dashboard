// Document format codes in Finansit
export const DOC_FORMATS = {
  QUOTE: 31,
  TAX_INVOICE: 11,
  DELIVERY_NOTE: 2,
  CREDIT_INVOICE: 12,
  PURCHASE_ORDER: 21,
  RECEIPT: 41,
} as const

// Israeli seasons mapping
export const ISRAELI_SEASONS = {
  SUMMER: { months: [5, 6, 7, 8, 9, 10], label: 'Summer', icon: '☀️' },
  WINTER: { months: [11, 12, 1, 2, 3, 4], label: 'Winter', icon: '🌧️' },
} as const

// Seasonal product categories
export const SEASONAL_CATEGORIES = {
  summer: ['AC Compressors', 'AC Filters', 'Coolant', 'Radiators', 'Belts', 'Water Pumps'],
  winter: ['Wiper Blades', 'Brake Pads', 'Batteries', 'Headlights', 'Heater Parts'],
} as const

export const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

// Redis cache TTLs (in seconds)
export const CACHE_TTL = {
  DASHBOARD: 5 * 60,       // 5 min
  ITEMS: 30 * 60,          // 30 min
  DOCUMENTS: 15 * 60,      // 15 min
  ANALYTICS: 60 * 60,      // 1 hour
  SEASONAL: 6 * 60 * 60,   // 6 hours
  AI_INSIGHTS: 2 * 60 * 60, // 2 hours
} as const

// Currency formatting
export const ILS_FORMAT = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

export const NUMBER_FORMAT = new Intl.NumberFormat('en-IL', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})
