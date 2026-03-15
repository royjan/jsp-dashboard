// ── Finansit API Types (matches actual API response) ──

export interface FinansitItem {
  code: string
  name: string
  english_name?: string
  barcode?: string
  group?: string
  supplier?: string
  price: number
  in_stock: number
  inquiry_count: number
  // Enriched fields (from /api/items/{code} or batch stock)
  stock_qty: number
  ordered_qty: number
  incoming_qty: number
  sold_this_year: number
  sold_last_year: number
  sold_2_years_ago: number
  sold_3_years_ago: number
  place?: string
  hs_code?: string
  category?: string
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

// ── Analytics Types ──

export interface DemandItem {
  code: string
  name: string
  request_count: number
  total_qty_requested: number
  stock_qty: number
  price: number
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
}

export interface TopSellingItem {
  code: string
  name: string
  total_qty_sold: number
  total_revenue: number
  invoice_count: number
  avg_price: number
  stock_qty: number
}

export interface ReorderItem {
  code: string
  name: string
  stock_qty: number
  incoming_qty: number
  inquiry_count: number
  sold_this_year: number
  sold_last_year: number
  price: number
  urgency_score: number
  demand_velocity: number
  stock_coverage: number
  seasonal_relevance: number
  customer_breadth: number
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
