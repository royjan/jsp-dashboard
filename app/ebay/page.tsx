'use client'

import { Suspense } from 'react'
import { motion } from 'framer-motion'
import { useEbayAnalytics } from '@/hooks/use-analytics'
import { useLocale } from '@/lib/locale-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ShoppingCart, Package, CheckCircle, AlertTriangle, Clock,
  XCircle, DollarSign, ArrowRight,
} from 'lucide-react'
import { ItemLink } from '@/components/shared/ItemLink'
import { formatNumber } from '@/lib/format'
import { cardVariants } from '@/lib/motion'


const STATUS_COLORS: Record<string, string> = {
  success: 'bg-green-500/15 text-green-600',
  pending: 'bg-amber-500/15 text-amber-600',
  error: 'bg-red-500/15 text-red-600',
  uploading: 'bg-blue-500/15 text-blue-600',
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-4 w-20 mb-3" /><Skeleton className="h-8 w-24" /></CardContent></Card>
        ))}
      </div>
      <Card><CardContent className="p-6"><Skeleton className="w-full h-[300px]" /></CardContent></Card>
    </div>
  )
}

export default function EbayPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <EbayContent />
    </Suspense>
  )
}

function EbayContent() {
  const { t } = useLocale()
  const { data, isLoading, error } = useEbayAnalytics()

  if (isLoading) return <LoadingSkeleton />
  if (error) return <div className="text-red-500 p-4">Error loading eBay data</div>
  if (!data) return null

  const items = data.items || {}
  const batches = data.batches || {}
  const recs = data.recommendations || {}
  const listings = data.recent_listings || []
  const alerts = data.stock_alerts || {}

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
        <motion.div custom={0} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-3 sm:p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                {t('ebay')} Listed
              </div>
              <div className="text-xl sm:text-2xl font-bold">{formatNumber(items.listed_count || 0)}</div>
              <div className="text-xs text-muted-foreground">${formatNumber(items.total_listed_value || 0)} total value</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={1} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <Clock className="h-3.5 w-3.5 text-amber-500" />
                Pending
              </div>
              <div className="text-xl sm:text-2xl font-bold">{formatNumber(items.pending_count || 0)}</div>
              <div className="text-xs text-muted-foreground">{formatNumber(items.error_count || 0)} errors</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={2} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <Package className="h-3.5 w-3.5 text-blue-500" />
                Batches
              </div>
              <div className="text-xl sm:text-2xl font-bold">{formatNumber(batches.total_batches || 0)}</div>
              <div className="text-xs text-muted-foreground">{formatNumber(batches.completed_batches || 0)} completed</div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div custom={3} variants={cardVariants} initial="hidden" animate="visible">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
                Alerts
              </div>
              <div className="text-xl sm:text-2xl font-bold">{formatNumber(alerts.zero_stock_alerts || 0)}</div>
              <div className="text-xs text-muted-foreground">{formatNumber(alerts.price_change_alerts || 0)} price changes</div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Recommendation Pipeline + Recent Listings */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
        {/* Recommendation Pipeline */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-violet-500" />
              Recommendation Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { label: 'Pending', value: recs.pending || 0, color: 'text-amber-500' },
                { label: 'Approved', value: recs.approved || 0, color: 'text-green-500' },
                { label: 'Listed', value: recs.listed || 0, color: 'text-blue-500' },
                { label: 'Rejected', value: recs.rejected || 0, color: 'text-red-400' },
              ].map((step) => (
                <div key={step.label} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{step.label}</span>
                  <span className={`text-lg font-bold ${step.color}`}>{formatNumber(step.value)}</span>
                </div>
              ))}
              <div className="pt-2 border-t text-xs text-muted-foreground">
                Avg score: {recs.avg_score || 0}/100 | Total: {recs.total || 0}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recent Listings */}
        <Card className="md:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-500" />
              Recent Listings
              <Badge variant="secondary" className="text-xs">{listings.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-start py-2 px-2">SKU</th>
                    <th className="text-start py-2 px-2">Title</th>
                    <th className="text-end py-2 px-2">Price</th>
                    <th className="text-center py-2 px-2">Status</th>
                    <th className="text-start py-2 px-2">Batch</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((item: any) => (
                    <tr key={item.id} className="border-b border-muted/50 hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-2 font-mono text-xs"><ItemLink code={item.sku} showCode /></td>
                      <td className="py-2 px-2 truncate max-w-[200px]" title={item.title}>{item.title || '-'}</td>
                      <td className="py-2 px-2 text-end">{item.price ? `$${formatNumber(item.price, 2)}` : '-'}</td>
                      <td className="py-2 px-2 text-center">
                        <Badge className={`text-[10px] ${STATUS_COLORS[item.upload_status] || ''}`}>
                          {item.upload_status}
                        </Badge>
                      </td>
                      <td className="py-2 px-2 text-xs text-muted-foreground truncate max-w-[120px]">{item.batch_name || '-'}</td>
                    </tr>
                  ))}
                  {listings.length === 0 && (
                    <tr><td colSpan={5} className="py-8 text-center text-muted-foreground">No listings yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
