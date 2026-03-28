// ── Finansit API Types (matches actual API response) ──

export interface FinansitItem {
  code: string
  name: string
  barcode?: string
  group?: string
  price: number
  in_stock: number
  inquiry_count: number
  // Enriched fields (from /api/items/{code} or batch stock)
  stock_qty: number
  ordered_qty: number
  incoming_qty: number
  sold_this_year: number
  sold_last_year: number
  sold_2y_ago: number
  sold_3y_ago: number
  place?: string
  hs_code?: string
  category?: string
  // Date fields from API
  sale_date?: string
  purchase_date?: string
  update_date?: string
  count_date?: string
  // Chain fields (item history)
  item_id_history?: string[]
  new_item_id?: string
  old_item_id?: string
  alias_codes?: string[]
  chain_history?: string[]
}

export interface ItemHistoryResponse {
  queried_code: string
  canonical_code: string
  canonical_name?: string
  item_id_history: string[]
}

export interface WarehouseStock {
  warehouse: string
  qty: number
  place: string
  ordered_qty: number
  incoming_qty: number
  sold_this_year: number
  sold_last_year: number
  sold_2y_ago: number
  sold_3y_ago: number
}

export interface StockDetail {
  item_code: string
  item_name: string | null
  total_qty: number
  total_ordered: number
  total_incoming: number
  total_sold_this_year: number
  total_sold_last_year: number
  total_sold_2y_ago: number
  total_sold_3y_ago: number
  warehouses: WarehouseStock[]
}

export interface DocumentListItem {
  format: string
  doc_number: string
  doc_date: string
  customer_code: string
  customer_name: string
  total: number
  vat: number
  grand_total: number
  status: string
  due_date: string
  warehouse?: string
  agent?: string
}

export interface DocumentLineItem {
  line_number: number
  item_code: string
  item_name: string
  quantity: number
  unit_price: number
  discount_percent: number
  line_total: number
  barcode?: string
}

export interface DocumentDetail extends DocumentListItem {
  format_name: string
  rounding: number
  ref_doc: string | null
  lines: DocumentLineItem[]
}

export interface DashboardData {
  open_invoices: { count: number; total: number }
  open_quotes: { count: number; total: number }
  open_delivery_notes: { count: number; total: number }
  this_month_sales: { count: number; total: number }
  format_totals: Array<{
    format: string
    name: string
    count: number
    total: number
    open_count: number
    open_total: number
  }>
}

// ── Customer Types ──

export interface CustomerListItem {
  code: string
  name: string
  account_status: string
  account_status_name?: string
  is_blocked: boolean
  address: string
  city: string
  zip: string
  phone: string
  contact: string
  tax_id: string
  payment_terms: string
  price_code: string
}

export interface CustomerBalance {
  customer_code: string
  customer_name: string
  is_blocked: boolean
  credit_limit: number
  credit_used: number
  is_over_credit: boolean
  net_balance: number
  payment_terms: string
  currency: string
  source?: string
}

export interface CustomerAgingBucket {
  count: number
  total: number
}

export interface CustomerAging {
  customer_code: string
  customer_name: string
  as_of: string
  grand_total: number
  buckets: {
    current: CustomerAgingBucket
    '1_30': CustomerAgingBucket
    '31_60': CustomerAgingBucket
    '61_90': CustomerAgingBucket
    over_90: CustomerAgingBucket
  }
  documents_count: number
  documents: DocumentListItem[]
}

export interface Receipt {
  invoice_ref: string
  payment_date?: string
  due_date?: string
  amount: number
  paid: number
  balance: number
}

// ── Item Category Types ──

export interface ItemCategory {
  group: number
  group_name: string
  code: string
  value: string
}

export interface CategoryValue {
  code: string
  name: string
}

export interface CategoryGroup {
  group: number
  name: string
  values: CategoryValue[]
}

// ── Document Format & Write Types ──

export interface DocumentFormatSummary {
  format: string
  name: string
  count: number
  total: number
  open_count: number
  open_total: number
}

export interface LineItemParams {
  item_code: string
  quantity?: number
  unit_price?: number
  item_name?: string
  discount_percent?: number
  warehouse?: string
  price_code?: string
  weight?: number
}

export interface CreateDocumentParams {
  format: string
  customer_code: string
  lines: LineItemParams[]
  doc_date?: string
  warehouse?: string
  agent?: string
  division?: string
  payment_terms?: string
  reduce_pc?: number
  from_doc_format?: string
  from_doc_number?: string
  doc_ref?: string
}

export interface CloneDocumentParams {
  source_format: string
  source_number: string
  doc_date?: string
  customer_code?: string
  warehouse?: string
  agent?: string
}

export interface ConvertDocumentParams {
  source_format: string
  source_number: string
  target_format: string
  doc_date?: string
  warehouse?: string
  agent?: string
  force?: boolean
  mark_source?: boolean
  line_numbers?: number[]
}

export interface UpdateDocumentParams {
  status?: string
  doc_ref?: string
  agent?: string
  division?: string
}

// ── Price Types ──

export interface PriceLookupResult {
  item_code: string
  item_name: string
  price: number
  price_code: string
  price_code_source: string
  customer_name?: string
}

export interface PriceHistoryEntry {
  item_code: string
  price: number
  price_code: string
  date: string
  currency: string
}

// ── Stock Summary Types ──

export interface StockSummaryItem {
  item_code: string
  item_name?: string
  group?: string
  total_qty: number
  total_ordered: number
  total_incoming: number
  total_sold_this_year: number
  total_sold_last_year: number
  total_sold_2y_ago: number
  total_sold_3y_ago: number
  sale_date?: string
  purchase_date?: string
  update_date?: string
  count_date?: string
}

// ── Search Types ──

export interface UnifiedSearchResult {
  query: string
  customers: CustomerListItem[]
  customers_count: number
  items: FinansitItem[]
  items_count: number
  descriptions: Array<{ code: string; description: string }>
  descriptions_count: number
}

// ── PostgreSQL Historical Types ──

export interface PgCustomerStats {
  customer_code: string
  customer_name: string
  total_revenue: number
  invoice_count: number
  open_balance: number
  last_invoice: string
}

export interface PgDailySales {
  date: string
  revenue: number
  invoice_count: number
}

export interface PgMonthlySales {
  year: number
  month: number
  item_code: string
  item_name: string
  quantity: number
  revenue: number
  invoice_count: number
  season: string
}

export interface PgFormatSummary {
  format: string
  count: number
  total: number
  open_count: number
  open_total: number
}

export interface PgItemSnapshot {
  item_code: string
  item_name: string
  qty: number
  ordered_qty: number
  incoming_qty: number
  sold_this_year: number
  sold_last_year: number
  sold_2y_ago: number
  sold_3y_ago: number
  retail_price: number
  warehouse: string
  place: string
  update_date: string
  snapshot_at: string
}

// ── Analytics Types ──

export interface DemandItem {
  code: string
  name: string
  request_count: number
  total_qty_requested: number
  stock_qty: number
  price: number
  sale_date?: string
  days_since_sale?: number
  alias_codes?: string[]
}

export interface SalesDataPoint {
  date: string
  revenue: number
  count: number
}

export interface SeasonalDataPoint {
  category: string
  month: number
  month_name: string
  avg_sales: number
  intensity: number
}

export interface DeadStockItem {
  code: string
  name: string
  stock_qty: number
  price: number
  capital_tied: number
  last_sold_year: number
  years_dead: number
  category?: string
  sale_date?: string
  count_date?: string
  purchase_date?: string
  days_since_sale?: number
  days_since_count?: number
  alias_codes?: string[]
}

export interface TopSellingItem {
  code: string
  name: string
  total_qty_sold: number
  total_revenue: number
  invoice_count: number
  avg_price: number
  stock_qty: number
  sale_date?: string
  trend?: 'rising' | 'falling' | 'stable'
  alias_codes?: string[]
}

export interface ReorderItem {
  code: string
  name: string
  stock_qty: number
  incoming_qty: number
  ordered_qty: number
  inquiry_count: number
  sold_this_year: number
  sold_last_year: number
  price: number
  urgency_score: number
  demand_velocity: number
  stock_coverage: number
  seasonal_relevance: number
  customer_breadth: number
  sale_date?: string
  purchase_date?: string
  days_since_sale?: number
  supplier_freshness?: number
  alias_codes?: string[]
  recommended_qty: number
}

// ── AI Types ──

export type InsightType = 'demand_spike' | 'seasonal_prediction' | 'dead_stock_warning' | 'reorder_urgency'
export type InsightSeverity = 'info' | 'warning' | 'critical'

export interface AIInsight {
  id: string
  type: InsightType
  severity: InsightSeverity
  title: string
  description: string
  related_items: string[]
  created_at: string
}

// ── UI Types ──

export type Period = '7d' | '30d' | '90d' | 'ytd' | '1y'
export type GroupBy = 'day' | 'week' | 'month'

export interface KPIData {
  label: string
  value: number
  previous_value?: number
  format: 'currency' | 'number' | 'percent'
  trend?: 'up' | 'down' | 'flat'
  change_percent?: number
}
