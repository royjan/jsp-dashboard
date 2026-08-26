'use client'

/**
 * One name per route, for the whole app.
 *
 * The top bar used to carry a 23-entry map against 76 page routes, so 53 screens
 * fell through to the generic "דשבורד" — including every customer, item,
 * document, supplier and bookkeeping drill-down. Two tabs of the dashboard were
 * indistinguishable, and the browser history was a wall of identical entries.
 *
 * Resolution order, most specific first:
 *   1. exact path            '/gap/catalog'
 *   2. dynamic pattern       '/customers/[code]/[tab]'
 *   3. longest static prefix '/suppliers/…' → suppliers
 *
 * Titles already carrying a translation key keep it, so the HE/EN toggle still
 * works on them. The rest are Hebrew literals: this is a Hebrew-first app and an
 * untranslated screen should read in Hebrew, not fall back to a generic word.
 */

import type { TranslationKey } from '@/lib/i18n'

export interface RouteTitle {
  /** Translation key, when the screen already has one. */
  key?: TranslationKey
  /** Hebrew title, used when there is no key and as the document-title source. */
  he: string
}

/** Exact matches. */
const EXACT: Record<string, RouteTitle> = {
  '/': { key: 'page.overview', he: 'סקירה' },
  '/search': { key: 'page.smartSearch', he: 'חיפוש חכם' },
  '/report': { key: 'page.report', he: 'דוח עסקי' },
  '/seasonal': { key: 'page.seasonal', he: 'עונתיות' },

  // inventory
  '/stock': { key: 'page.stock', he: 'מלאי' },
  '/stock/demand': { key: 'page.demand', he: 'ביקוש' },
  '/stock-forecast': { key: 'page.stockForecast', he: 'תחזית מלאי' },
  '/gap': { key: 'page.gap', he: 'פערים' },
  '/gap/catalog': { key: 'page.catalogGap', he: 'פערי קטלוג' },
  '/scrap': { key: 'page.scrap', he: 'מלאי מת' },
  '/returns': { key: 'page.returns', he: 'החזרות' },
  '/catalog-links': { he: 'חיבורי קטלוג' },
  '/reorder': { key: 'page.reorder', he: 'ניהול הזמנות מחדש' },
  '/alerts': { he: 'התראות מלאי' },

  // sales & customers
  '/customers': { key: 'page.customers', he: 'לקוחות' },
  '/customers/health-score': { key: 'page.customerHealth', he: 'בריאות לקוחות' },
  '/receivables': { key: 'page.receivables', he: 'גיול חובות' },
  '/margin': { he: 'רווחיות' },
  '/pricing': { key: 'page.pricing', he: 'תמחור' },
  '/ebay': { key: 'page.ebay', he: 'eBay' },

  // sales rep
  '/sales-rep': { key: 'page.salesRep', he: 'נציג מכירות' },
  '/sales-rep/customers': { he: 'הלקוחות שלי' },
  '/sales-rep/price-check': { he: 'בדיקת פריט' },
  '/sales-rep/visits': { he: 'היסטוריית ביקורים' },

  // operations
  '/suppliers': { key: 'page.suppliers', he: 'ספקים' },
  '/competitors': { he: 'מתחרים' },
  '/shipments': { he: 'משלוחים' },
  '/deliveries': { he: 'חלוקה' },
  '/deliveries/driver': { he: 'מסך נהג' },
  '/vehicle-intelligence': { key: 'page.vehicleIntelligence', he: 'מודיעין רכב' },

  // bookkeeping
  '/bookkeeping': { he: 'הנהלת חשבונות' },
  '/bookkeeping/accounts': { he: 'אינדקס הנהח"ש' },
  '/bookkeeping/trial-balance': { he: 'מאזן בוחן' },
  '/bookkeeping/journal': { he: 'פקודות יומן' },
  '/bookkeeping/vat': { he: 'דוח מע"מ' },
  '/bookkeeping/cash': { he: 'קופה' },
  '/bookkeeping/purchasing': { he: 'רכש' },
  '/bookkeeping/years': { he: 'שנות כספים' },

  // chat admin
  '/chat-insights': { key: 'page.chatInsights', he: 'תובנות צ׳אט' },
  '/chat/flow-decisions': { he: 'החלטות זרימה' },
  '/chat/flow-decisions/observatory': { he: 'מצפה החלטות' },
  '/chat/word-mappings': { he: 'מיפוי מונחים' },
  '/chat/parts-analytics': { he: 'אנליטיקת חלקים' },
  '/chat/feedback': { he: 'משוב' },
  '/chat/simulator': { he: 'סימולטור' },

  '/login': { he: 'התחברות' },
}

/**
 * Dynamic routes. `:` marks a segment that matches anything, so the pattern is
 * compared segment-by-segment rather than by string equality. Ordered
 * most-specific first; the first match wins.
 */
const DYNAMIC: Array<[string, RouteTitle]> = [
  ['/customers/:/:', { he: 'כרטיס לקוח' }],
  ['/customers/:', { he: 'כרטיס לקוח' }],
  ['/items/:', { he: 'כרטיס פריט' }],
  ['/documents/:/:', { he: 'מסמך' }],
  ['/bookkeeping/accounts/:', { he: 'כרטסת' }],
  ['/bookkeeping/journal/:', { he: 'פקודת יומן' }],
  ['/bookkeeping/cash/:', { he: 'קבלה' }],
  ['/suppliers/:/demand', { he: 'ביקוש לספק' }],
  ['/suppliers/:/history', { he: 'היסטוריית ספק' }],
  ['/suppliers/:/pending', { he: 'הזמנות פתוחות' }],
  ['/suppliers/:/prices', { he: 'מחירי ספק' }],
  ['/suppliers/:/shipments', { he: 'משלוחי ספק' }],
  ['/suppliers/:', { he: 'כרטיס ספק' }],
  ['/shipments/:', { he: 'משלוח' }],
  ['/deliveries/:', { he: 'מסלול חלוקה' }],
  ['/chat/flow-decisions/edit/:', { he: 'עריכת החלטה' }],
  ['/chat/flow-decisions/:', { he: 'החלטות זרימה' }],
  ['/chat/simulator/:', { he: 'ריצת סימולטור' }],
  ['/chat/diego', { he: 'דייגו' }],
  ['/ebay-reco', { he: 'המלצות eBay' }],
]

/** Last resort before the generic label — a section name beats "דשבורד". */
const PREFIX: Array<[string, RouteTitle]> = [
  ['/bookkeeping', { he: 'הנהלת חשבונות' }],
  ['/sales-rep', { key: 'page.salesRep', he: 'נציג מכירות' }],
  ['/suppliers', { key: 'page.suppliers', he: 'ספקים' }],
  ['/customers', { key: 'page.customers', he: 'לקוחות' }],
  ['/chat', { he: 'ניהול צ׳אט' }],
  ['/stock', { key: 'page.stock', he: 'מלאי' }],
  ['/gap', { key: 'page.gap', he: 'פערים' }],
]

function matchesPattern(pathSegs: string[], pattern: string): boolean {
  const patSegs = pattern.split('/').filter(Boolean)
  // A pattern may be shorter than the path (catch-all routes like /chat/diego
  // and /ebay-reco, whose optional segments are part of the same screen).
  if (patSegs.length > pathSegs.length) return false
  return patSegs.every((seg, i) => seg === ':' || seg === pathSegs[i])
}

export function resolveRouteTitle(pathname: string): RouteTitle | undefined {
  if (EXACT[pathname]) return EXACT[pathname]

  const segs = pathname.split('/').filter(Boolean)

  for (const [pattern, title] of DYNAMIC) {
    if (matchesPattern(segs, pattern)) return title
  }
  for (const [prefix, title] of PREFIX) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return title
  }
  return undefined
}

/** Suffix for the browser tab, so two open tabs are told apart at a glance. */
export const APP_TITLE_SUFFIX = "ג'אן"
