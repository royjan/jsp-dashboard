import { pgSchema, pgTable, integer, text, numeric, date, real, timestamp, serial, primaryKey, boolean, uuid, varchar, jsonb } from 'drizzle-orm/pg-core'

// All tables live in the "dashboard" schema
export const dashboardSchema = pgSchema('dashboard')

// eBay uploader schema
export const ebaySchema = pgSchema('ebay_uploader')

/**
 * Search analytics from the chat app (jsp-chat-js).
 * This table lives in the public schema (created by Prisma in chat).
 * Read-only from dashboard — chat writes to it.
 */
export const searchAnalytics = pgTable('search_analytics', {
  id: uuid('id').primaryKey(),
  conversationId: varchar('conversation_id', { length: 255 }).notNull(),
  userId: varchar('user_id', { length: 255 }),
  query: text('query').notNull(),
  normalizedQuery: text('normalized_query'),
  intent: varchar('intent', { length: 100 }).notNull(),
  resultCount: integer('result_count').default(0).notNull(),
  hasResults: boolean('has_results').default(false).notNull(),
  vehicleContext: jsonb('vehicle_context'),
  partContext: jsonb('part_context'),
  responseTimeMs: integer('response_time_ms'),
  userAction: varchar('user_action', { length: 50 }),
  clickedResult: text('clicked_result'),
  source: varchar('source', { length: 20 }).default('realtime').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Stock alert rules — admin-configured notifications when item stock
 * crosses thresholds. Checked by /api/cron/check-alerts.
 */
export const alertRules = dashboardSchema.table('alert_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  itemCodes: text('item_codes').array(),
  topNMonths: integer('top_n_months'),
  topN: integer('top_n'),
  thresholdQty: numeric('threshold_qty').notNull().default('0'),
  comparator: varchar('comparator', { length: 10 }).notNull().default('lte'),
  recipients: text('recipients').array().notNull(),
  channel: varchar('channel', { length: 20 }).notNull().default('email'),
  enabled: boolean('enabled').notNull().default(true),
  cooldownHours: integer('cooldown_hours').notNull().default(24),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: varchar('created_by', { length: 255 }),
})

/**
 * Log of alert rule firings (audit + cooldown).
 */
export const alertFirings = dashboardSchema.table('alert_firings', {
  id: uuid('id').primaryKey().defaultRandom(),
  ruleId: uuid('rule_id').notNull(),
  itemCode: text('item_code').notNull(),
  itemName: text('item_name'),
  stockQty: numeric('stock_qty').notNull(),
  thresholdQty: numeric('threshold_qty').notNull(),
  firedAt: timestamp('fired_at', { withTimezone: true }).defaultNow().notNull(),
  notificationSent: boolean('notification_sent').notNull().default(false),
  error: text('error'),
})

/**
 * Monthly sales aggregated by item.
 * Populated from invoice line items during sync.
 */
export const monthlySales = dashboardSchema.table('monthly_sales', {
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  itemCode: text('item_code').notNull(),
  itemName: text('item_name'),
  quantity: numeric('quantity').default('0'),
  revenue: numeric('revenue').default('0'),
  invoiceCount: integer('invoice_count').default(0),
  season: text('season'),
}, (table) => [
  primaryKey({ columns: [table.year, table.month, table.itemCode] }),
])

/**
 * Daily sales totals.
 * Populated from invoice headers during sync.
 */
export const dailySales = dashboardSchema.table('daily_sales', {
  date: date('date').notNull().primaryKey(),
  revenue: numeric('revenue').default('0'),
  invoiceCount: integer('invoice_count').default(0),
})

/**
 * Item inventory snapshots taken during sync.
 * One row per item per day.
 */
export const itemSnapshots = dashboardSchema.table('item_snapshots', {
  id: serial('id').primaryKey(),
  itemCode: text('item_code').notNull(),
  itemName: text('item_name'),
  stockQty: numeric('stock_qty').default('0'),
  price: numeric('price').default('0'),
  soldThisYear: numeric('sold_this_year').default('0'),
  soldLastYear: numeric('sold_last_year').default('0'),
  inquiryCount: numeric('inquiry_count').default('0'),
  category: text('category'),
  snapshotDate: date('snapshot_date').notNull().defaultNow(),
  saleDate: text('sale_date'),
  purchaseDate: text('purchase_date'),
  updateDate: text('update_date'),
  countDate: text('count_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * eBay price comparison cache — our dead-stock parts vs live eBay "new" asking
 * prices across marketplaces. Populated by the /api/cron/ebay-prices warm job
 * (rate-limit-aware, rolling refresh by checked_at). Keyed by the canonical
 * item code; the join in ebay-recommend is chain-aware. `markets` holds the
 * per-country breakdown; the top-level columns are the best (highest) market.
 */
export const ebayPriceCompare = dashboardSchema.table('ebay_price_compare', {
  itemCode: text('item_code').primaryKey(),
  bestMarket: text('best_market'),          // e.g. EBAY_DE  (null when no comparable found)
  medianIls: integer('median_ils'),         // best market's median, converted to ₪
  medianLocal: numeric('median_local'),      // best market's median in its own currency
  currency: text('currency'),               // best market's currency (EUR/GBP/USD/…)
  matchCount: integer('match_count').default(0),  // # of genuine matches behind the best median (confidence)
  oem: boolean('oem').default(false),        // true = median built from genuine/OEM listings (fair vs our OEM stock)
  bestUrl: text('best_url'),                // eBay link to the representative best-match listing
  bestTitle: text('best_title'),            // that listing's title
  markets: jsonb('markets'),                // per-country breakdown [{ market, currency, medianLocal, medianIls, matchCount, oem, url, title }]
  checkedAt: timestamp('checked_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Document headers (invoices, quotes, delivery notes, credit notes).
 * Populated externally or via bulk sync.
 */
export const documents = dashboardSchema.table('documents', {
  year: integer('year').notNull(),
  format: text('format').notNull(),
  docNumber: text('doc_number').notNull(),
  status: text('status'),
  newStatus: text('new_status'),
  docDate: date('doc_date'),
  dueDate: date('due_date'),
  customerCode: text('customer_code'),
  customerName: text('customer_name'),
  agent: text('agent'),
  warehouse: text('warehouse'),
  total: numeric('total'),
  vat: numeric('vat'),
  grandTotal: numeric('grand_total'),
  rounding: numeric('rounding'),
}, (table) => [
  primaryKey({ columns: [table.year, table.format, table.docNumber] }),
])

/**
 * Customer statistics aggregated per year.
 * Populated from invoice documents during sync.
 */
export const customerStats = dashboardSchema.table('customer_stats', {
  year: integer('year').notNull(),
  customerCode: text('customer_code').notNull(),
  customerName: text('customer_name'),
  invoiceCount: integer('invoice_count').default(0),
  totalRevenue: numeric('total_revenue').default('0'),
  openCount: integer('open_count').default(0),
  openBalance: numeric('open_balance').default('0'),
  lastInvoice: date('last_invoice'),
}, (table) => [
  primaryKey({ columns: [table.year, table.customerCode] }),
])

/**
 * Document format summary per year.
 * Aggregated counts and totals by document type.
 */
export const formatSummary = dashboardSchema.table('format_summary', {
  year: integer('year').notNull(),
  format: text('format').notNull(),
  count: integer('count').default(0),
  total: numeric('total').default('0'),
  openCount: integer('open_count').default(0),
  openTotal: numeric('open_total').default('0'),
}, (table) => [
  primaryKey({ columns: [table.year, table.format] }),
])

// ── Reorder Queue (Kanban Board) ──

export const reorderStageEnum = dashboardSchema.enum('reorder_stage', [
  'suggested', 'approved', 'ordered', 'received',
])

export const reorderQueue = dashboardSchema.table('reorder_queue', {
  id: serial('id').primaryKey(),
  itemCode: text('item_code').notNull(),
  itemName: text('item_name'),
  suggestedQty: integer('suggested_qty').notNull().default(0),
  approvedQty: integer('approved_qty'),
  currentStock: integer('current_stock').default(0),
  avgMonthlySales: numeric('avg_monthly_sales'),
  stage: reorderStageEnum().notNull().default('suggested'),
  supplierInfo: text('supplier_info'),
  notes: text('notes'),
  urgencyScore: numeric('urgency_score'),
  price: numeric('price'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  movedAt: timestamp('moved_at', { withTimezone: true }).defaultNow(),
})

export type ReorderQueueItem = typeof reorderQueue.$inferSelect
export type NewReorderQueueItem = typeof reorderQueue.$inferInsert

// ── Customer Health Tracking ──

/**
 * Daily snapshots of customer health scores.
 * One row per customer per snapshot date.
 */
export const customerHealthSnapshots = dashboardSchema.table('customer_health_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerCode: text('customer_code').notNull(),
  customerName: text('customer_name').notNull(),
  score: integer('score').notNull(),
  band: varchar('band', { length: 10 }).notNull(), // green | yellow | red
  factors: jsonb('factors'), // { returnRate, daysSinceLastPurchase, trend, yoyChangePct }
  previousBand: varchar('previous_band', { length: 10 }), // band from last snapshot
  snapshotDate: date('snapshot_date').notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Records when a customer's health band changes (e.g. green→yellow).
 * Used to drive the win-back workflow and alerts.
 */
export const customerHealthTransitions = dashboardSchema.table('customer_health_transitions', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerCode: text('customer_code').notNull(),
  customerName: text('customer_name').notNull(),
  fromBand: varchar('from_band', { length: 10 }).notNull(),
  toBand: varchar('to_band', { length: 10 }).notNull(),
  transitionDate: date('transition_date').notNull().defaultNow(),
  score: integer('score'), // score at time of transition
  factors: jsonb('factors'), // factors at time of transition
  acknowledged: boolean('acknowledged').notNull().default(false),
  acknowledgedBy: varchar('acknowledged_by', { length: 255 }),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type CustomerHealthSnapshot = typeof customerHealthSnapshots.$inferSelect
export type NewCustomerHealthSnapshot = typeof customerHealthSnapshots.$inferInsert
export type CustomerHealthTransition = typeof customerHealthTransitions.$inferSelect
export type NewCustomerHealthTransition = typeof customerHealthTransitions.$inferInsert

// ── eBay Uploader ──

export const ebayRecommendations = ebaySchema.table('recommendations', {
  id: serial('id').primaryKey(),
  itemCode: text('item_code').notNull(),
  itemName: text('item_name'),
  reason: text('reason'),
  score: integer('score').default(0),
  suggestedPriceIls: real('suggested_price_ils'),
  suggestedPriceUsd: real('suggested_price_usd'),
  stockQty: integer('stock_qty').default(0),
  aiTitle: text('ai_title'),
  aiDescription: text('ai_description'),
  status: text('status').notNull().default('pending'),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedBy: text('reviewed_by'),
  soldThisYear: integer('sold_this_year').default(0),
  soldLastYear: integer('sold_last_year').default(0),
  sold2yAgo: integer('sold_2y_ago').default(0),
  sold3yAgo: integer('sold_3y_ago').default(0),
  incomingQty: integer('incoming_qty').default(0),
  orderedQty: integer('ordered_qty').default(0),
  oldItemId: text('old_item_id'),
  newItemId: text('new_item_id'),
  itemIdHistory: text('item_id_history').default('[]'),
  createdItemId: integer('created_item_id'),
  createdBatchId: integer('created_batch_id'),
  source: text('source').default('ai'),
})

export const ebayItems = ebaySchema.table('items', {
  id: serial('id').primaryKey(),
  batchId: integer('batch_id').notNull(),
  sku: text('sku').notNull(),
  title: text('title'),
  price: real('price'),
  currency: text('currency').default('USD'),
  quantity: integer('quantity').default(1),
  categoryName: text('category_name'),
  uploadStatus: text('upload_status').default('pending'),
  ebayListingId: text('ebay_listing_id'),
  ebayOfferId: text('ebay_offer_id'),
  errorMessage: text('error_message'),
  brand: text('brand'),
  mpn: text('mpn'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

export const ebayBatches = ebaySchema.table('batches', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status').notNull().default('draft'),
  totalItems: integer('total_items').default(0),
  uploadedItems: integer('uploaded_items').default(0),
  failedItems: integer('failed_items').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export const ebayListingUpdates = ebaySchema.table('listing_updates', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id'),
  sku: text('sku').notNull(),
  updateType: text('update_type').notNull(),
  oldValue: text('old_value'),
  newValue: text('new_value'),
  description: text('description'),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ── Chat App (public schema, read-only) ──

export const chatHistory = pgTable('chat_history', {
  id: uuid('id').primaryKey(),
  conversationId: varchar('conversation_id', { length: 255 }),
  userId: varchar('user_id', { length: 255 }),
  messages: jsonb('messages'),
  metadata: jsonb('metadata'),
  intent: varchar('intent', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  lastUserMessageAt: timestamp('last_user_message_at', { withTimezone: true }),
})

export const feedback = pgTable('feedback', {
  id: uuid('id').primaryKey(),
  conversationId: varchar('conversation_id', { length: 255 }),
  messageId: varchar('message_id', { length: 255 }),
  userId: varchar('user_id', { length: 255 }),
  type: text('type').notNull(),
  metadata: jsonb('metadata'),
  suggestedItemId: varchar('suggested_item_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

export type EbayRecommendation = typeof ebayRecommendations.$inferSelect
export type NewEbayRecommendation = typeof ebayRecommendations.$inferInsert
export type EbayItem = typeof ebayItems.$inferSelect
export type EbayBatch = typeof ebayBatches.$inferSelect

// Type exports for consumer code
export type MonthlySale = typeof monthlySales.$inferSelect
export type NewMonthlySale = typeof monthlySales.$inferInsert
export type DailySale = typeof dailySales.$inferSelect
export type NewDailySale = typeof dailySales.$inferInsert
export type ItemSnapshot = typeof itemSnapshots.$inferSelect
export type NewItemSnapshot = typeof itemSnapshots.$inferInsert
export type Document = typeof documents.$inferSelect
export type NewDocument = typeof documents.$inferInsert
// ── Sales Rep Visit Tracking ──

export const visitOutcomeEnum = dashboardSchema.enum('visit_outcome', [
  'interested', 'ordered', 'not_interested', 'follow_up',
])

export const visitTypeEnum = dashboardSchema.enum('visit_type', [
  'planned', 'walk_in',
])

export const salesVisits = dashboardSchema.table('sales_visits', {
  id: uuid('id').primaryKey().defaultRandom(),
  repName: varchar('rep_name', { length: 255 }).notNull(),
  customerCode: text('customer_code').notNull(),
  customerName: text('customer_name').notNull(),
  visitDate: date('visit_date').notNull().defaultNow(),
  visitType: visitTypeEnum().notNull().default('planned'),
  notes: text('notes'),
  itemsShown: jsonb('items_shown').$type<string[]>().default([]),
  outcome: visitOutcomeEnum().notNull().default('interested'),
  followUpDate: date('follow_up_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type SalesVisit = typeof salesVisits.$inferSelect
export type NewSalesVisit = typeof salesVisits.$inferInsert

export type SearchAnalytic = typeof searchAnalytics.$inferSelect

// ── Delivery Tracking ──

export const deliveryStatusEnum = dashboardSchema.enum('delivery_status', [
  'pending', 'assigned', 'in_transit', 'delivered', 'failed',
])

export const deliveries = dashboardSchema.table('deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentNumber: text('document_number').notNull(),
  customerCode: text('customer_code'),
  customerName: text('customer_name'),
  customerAddress: text('customer_address'),
  driverName: text('driver_name'),
  status: deliveryStatusEnum().notNull().default('pending'),
  assignedAt: timestamp('assigned_at', { withTimezone: true }),
  departedAt: timestamp('departed_at', { withTimezone: true }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  notes: text('notes'),
  deliveryLat: numeric('delivery_lat'),
  deliveryLng: numeric('delivery_lng'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const deliveryPhotos = dashboardSchema.table('delivery_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  deliveryId: uuid('delivery_id').notNull().references(() => deliveries.id),
  photoUrl: text('photo_url').notNull(),
  photoType: varchar('photo_type', { length: 20 }).notNull().default('delivery'), // delivery | signature | damage
  capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
  notes: text('notes'),
})

export const deliveryStatusLog = dashboardSchema.table('delivery_status_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  deliveryId: uuid('delivery_id').notNull().references(() => deliveries.id),
  status: deliveryStatusEnum().notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).defaultNow().notNull(),
  changedBy: text('changed_by'),
  notes: text('notes'),
  lat: numeric('lat'),
  lng: numeric('lng'),
})

export type Delivery = typeof deliveries.$inferSelect
export type NewDelivery = typeof deliveries.$inferInsert
export type DeliveryPhoto = typeof deliveryPhotos.$inferSelect
export type NewDeliveryPhoto = typeof deliveryPhotos.$inferInsert
export type DeliveryStatusLog = typeof deliveryStatusLog.$inferSelect
export type NewDeliveryStatusLog = typeof deliveryStatusLog.$inferInsert

// ── Supplier Portal ──

export const supplierOrderStatusEnum = dashboardSchema.enum('supplier_order_status', [
  'pending', 'confirmed', 'shipped', 'delivered', 'partial',
])

export const supplierUploadStatusEnum = dashboardSchema.enum('supplier_upload_status', [
  'pending', 'processing', 'completed', 'error',
])

export const supplierProfiles = dashboardSchema.table('supplier_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplierCode: text('supplier_code').notNull().unique(),
  supplierName: text('supplier_name').notNull(),
  shipmentTag: text('shipment_tag'),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  leadTimeDays: integer('lead_time_days'),
  paymentTerms: text('payment_terms'),
  notes: text('notes'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const supplierPriceUploads = dashboardSchema.table('supplier_price_uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplierCode: text('supplier_code').notNull(),
  fileName: text('file_name').notNull(),
  uploadDate: timestamp('upload_date', { withTimezone: true }).defaultNow().notNull(),
  status: supplierUploadStatusEnum().notNull().default('pending'),
  itemsCount: integer('items_count').default(0),
  errorsCount: integer('errors_count').default(0),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  notes: text('notes'),
  parsedData: jsonb('parsed_data'),
})

export const supplierOrderConfirmations = dashboardSchema.table('supplier_order_confirmations', {
  id: uuid('id').primaryKey().defaultRandom(),
  documentFormat: text('document_format').notNull(),
  documentNumber: text('document_number').notNull(),
  supplierCode: text('supplier_code').notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  estimatedDelivery: date('estimated_delivery'),
  actualDelivery: date('actual_delivery'),
  status: supplierOrderStatusEnum().notNull().default('pending'),
  notes: text('notes'),
  confirmedItems: jsonb('confirmed_items'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type SupplierProfile = typeof supplierProfiles.$inferSelect
export type NewSupplierProfile = typeof supplierProfiles.$inferInsert
export type SupplierPriceUpload = typeof supplierPriceUploads.$inferSelect
export type NewSupplierPriceUpload = typeof supplierPriceUploads.$inferInsert
export type SupplierOrderConfirmation = typeof supplierOrderConfirmations.$inferSelect
export type NewSupplierOrderConfirmation = typeof supplierOrderConfirmations.$inferInsert

/* ──────────────────────────────────────────────────────────────────────────
 * Chat-admin tables (owned by jsp-chat-js, public schema, shared Neon DB).
 * Read+write from the dashboard's integrated /chat/* admin. Timestamps are
 * `timestamp without time zone`; enum columns modeled as varchar().$type<>.
 * part_descriptions.embedding (pgvector) is intentionally omitted — embedding
 * I/O stays raw SQL (lib/chat-admin/embeddings + the simulate cosine search).
 * ────────────────────────────────────────────────────────────────────────── */

export const flowDecisionsV2 = pgTable('flow_decisions_v2', {
  id: uuid('id').primaryKey().defaultRandom(),
  partDescription: varchar('part_description').notNull(),
  category: varchar('category').notNull(),
  subcategory: varchar('subcategory').notNull(),
  schema: varchar('schema').notNull(),
  status: varchar('status').$type<'suggestion' | 'approved' | 'rejected'>().notNull().default('suggestion'),
  createdBy: varchar('created_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull(),
  feedbackCount: integer('feedback_count').notNull().default(0),
  isDefault: boolean('is_default').notNull().default(false),
  metadata: jsonb('metadata'),
  lambdaTarget: varchar('lambda_target').notNull().default('partslink'),
  vehicleYearFrom: integer('vehicle_year_from'),
  vehicleYearTo: integer('vehicle_year_to'),
  vehicleModel: varchar('vehicle_model'),
  vehicleFuelType: varchar('vehicle_fuel_type'),
  vehicleEngineModel: varchar('vehicle_engine_model'),
  vinPattern: varchar('vin_pattern'),
  source: varchar('source'),
  userIds: text('user_ids').array(),
  conversationIds: text('conversation_ids').array(),
  confidence: numeric('confidence'),
  approvedAt: timestamp('approved_at'),
  approvedBy: varchar('approved_by'),
  rejectedAt: timestamp('rejected_at'),
  rejectedBy: varchar('rejected_by'),
  rejectionReason: text('rejection_reason'),
  lastConfidenceUpdate: timestamp('last_confidence_update'),
  learnedConfidence: numeric('learned_confidence'),
})

export const partDescriptions = pgTable('part_descriptions', {
  description: varchar('description').primaryKey(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull(),
  usageCount: integer('usage_count').notNull().default(0),
  lastAccessed: timestamp('last_accessed').notNull().defaultNow(),
  originalDescription: text('original_description').notNull(),
})

export const directParts = pgTable('direct_parts', {
  id: uuid('id').primaryKey().defaultRandom(),
  flowDecisionId: uuid('flow_decision_id').notNull(),
  partId: varchar('part_id').notNull(),
  name: varchar('name').notNull(),
  imageUrl: varchar('image_url'),
  price: numeric('price'),
  currency: varchar('currency').notNull().default('ILS'),
  supplier: varchar('supplier'),
  inStock: boolean('in_stock').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull(),
})

export const wordMappings = pgTable('word_mappings', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceWord: varchar('source_word').notNull(),
  sourceLanguage: varchar('source_language').notNull(),
  targetWord: varchar('target_word').notNull(),
  targetLanguage: varchar('target_language').notNull(),
  mappingType: varchar('mapping_type').$type<'translation' | 'synonym'>().notNull(),
  confidence: numeric('confidence').notNull().default('1.0'),
  usageCount: integer('usage_count').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  category: varchar('category'),
  metadata: jsonb('metadata'),
  createdBy: varchar('created_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull(),
  lastUsedAt: timestamp('last_used_at'),
  isDefault: boolean('is_default').notNull().default(false),
})

export const wordMappingSuggestions = pgTable('word_mapping_suggestions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceWord: varchar('source_word').notNull(),
  sourceLanguage: varchar('source_language').notNull(),
  targetWord: varchar('target_word').notNull(),
  targetLanguage: varchar('target_language').notNull(),
  mappingType: varchar('mapping_type').$type<'translation' | 'synonym'>().notNull(),
  confidence: numeric('confidence').notNull(),
  evidence: jsonb('evidence').notNull(),
  status: varchar('status').$type<'pending' | 'approved' | 'rejected'>().notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at'),
  reviewedBy: varchar('reviewed_by'),
  rejectionReason: text('rejection_reason'),
})

export const lambdaStatus = pgTable('lambda_status', {
  id: uuid('id').primaryKey().defaultRandom(),
  serviceName: varchar('service_name').notNull(),
  status: varchar('status').$type<'healthy' | 'degraded' | 'down' | 'unknown'>().notNull().default('unknown'),
  errorType: varchar('error_type'),
  errorMessage: text('error_message'),
  lastSuccess: timestamp('last_success'),
  lastFailure: timestamp('last_failure'),
  lastCheck: timestamp('last_check'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  updatedAt: timestamp('updated_at').notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
})

export const searchTracking = pgTable('search_tracking', {
  id: uuid('id').primaryKey().defaultRandom(),
  searchId: varchar('search_id').notNull(),
  userId: varchar('user_id').notNull(),
  userEmail: varchar('user_email'),
  conversationId: varchar('conversation_id').notNull(),
  vin: varchar('vin').notNull(),
  parts: jsonb('parts').notNull(),
  lambdaType: varchar('lambda_type').notNull(),
  status: varchar('status').$type<'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'>().notNull().default('queued'),
  queuePosition: integer('queue_position'),
  errorMessage: text('error_message'),
  partsFound: integer('parts_found'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  durationMs: integer('duration_ms'),
  licensePlate: varchar('license_plate'),
})
