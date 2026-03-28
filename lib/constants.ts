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
// Cron warms cache every 2h during business hours; TTLs just need to survive the gap
export const CACHE_TTL = {
  DASHBOARD: 3 * 60 * 60,    // 3 hours (refreshed every 2h by cron)
  ITEMS: 3 * 60 * 60,        // 3 hours
  DOCUMENTS: 3 * 60 * 60,    // 3 hours
  ANALYTICS: 3 * 60 * 60,    // 3 hours
  SEASONAL: 48 * 60 * 60,    // 48 hours (changes rarely, survives weekend)
  AI_INSIGHTS: 2 * 60 * 60,  // 2 hours
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
