// Deliberately NOT a 'use client' module: the [tab] route validates the segment
// on the server, and a value exported from a client module arrives there as a
// client reference (`CUSTOMER_TABS.includes is not a function`), not an array.
export const CUSTOMER_TABS = ['purchases', 'orders', 'receipts', 'documents', 'unpaid'] as const
export type CustomerTab = (typeof CUSTOMER_TABS)[number]
