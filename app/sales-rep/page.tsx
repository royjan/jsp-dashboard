'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import {
  DollarSign, Users, ClipboardList, AlertTriangle,
  CalendarCheck, Loader2, Briefcase,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SalesRepBottomNav } from '@/components/sales-rep/BottomNav'

export default function SalesRepHubPage() {
  const [repName] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('sales-rep-name') || ''
    }
    return ''
  })

  const { data: customersData, isLoading: customersLoading } = useQuery({
    queryKey: ['sales-rep-customers'],
    queryFn: async () => {
      const res = await fetch('/api/sales-rep/customers')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })

  const { data: visitsData, isLoading: visitsLoading } = useQuery({
    queryKey: ['sales-rep-visits', repName],
    queryFn: async () => {
      const params = new URLSearchParams({ days: '7' })
      if (repName) params.set('rep_name', repName)
      const res = await fetch(`/api/sales-rep/visits?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 2 * 60 * 1000,
  })

  // Cache customers locally
  useEffect(() => {
    if (customersData?.customers) {
      try {
        localStorage.setItem('sales-rep-customers-cache', JSON.stringify(customersData.customers))
      } catch { /* quota exceeded */ }
    }
  }, [customersData])

  const redCustomers = customersData?.summary?.red || 0
  const yellowCustomers = customersData?.summary?.yellow || 0
  const visitsThisWeek = visitsData?.stats?.thisWeek || 0

  // Today's follow-ups
  const todayStr = new Date().toISOString().split('T')[0]
  const todayFollowUps = (visitsData?.visits || []).filter(
    (v: any) => v.followUpDate === todayStr
  ).length

  return (
    <div className="min-h-dvh bg-background flex flex-col" dir="rtl">
      {/* Header */}
      <header className="px-4 pt-4 pb-2 safe-area-top">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Briefcase className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">נציג שטח</h1>
            <p className="text-sm text-muted-foreground">
              {new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 px-4 pb-24 overflow-y-auto space-y-5 pt-3">
        {/* Today's Stats */}
        <div>
          <h2 className="text-base font-semibold text-muted-foreground mb-3">לוח היום</h2>
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-4 text-center space-y-1">
                <CalendarCheck className="h-6 w-6 mx-auto text-blue-500" />
                <p className="text-3xl font-bold">
                  {visitsLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : visitsThisWeek}
                </p>
                <p className="text-xs text-muted-foreground">ביקורים השבוע</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center space-y-1">
                <CalendarCheck className="h-6 w-6 mx-auto text-amber-500" />
                <p className="text-3xl font-bold">
                  {visitsLoading ? <Loader2 className="h-6 w-6 animate-spin mx-auto" /> : todayFollowUps}
                </p>
                <p className="text-xs text-muted-foreground">מעקבים להיום</p>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Attention Required */}
        {(redCustomers > 0 || yellowCustomers > 0) && (
          <div>
            <h2 className="text-base font-semibold text-muted-foreground mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              דורשים תשומת לב
            </h2>
            <Card className="border-amber-500/30">
              <CardContent className="p-4 space-y-3">
                {redCustomers > 0 && (
                  <Link href="/sales-rep/customers" className="flex items-center justify-between min-h-[44px]">
                    <div className="flex items-center gap-3">
                      <span className="h-3 w-3 rounded-full bg-red-500 shrink-0" />
                      <span className="text-base font-medium">לקוחות בסיכון</span>
                    </div>
                    <Badge variant="destructive" className="text-base px-3">
                      {customersLoading ? '...' : redCustomers}
                    </Badge>
                  </Link>
                )}
                {yellowCustomers > 0 && (
                  <Link href="/sales-rep/customers" className="flex items-center justify-between min-h-[44px]">
                    <div className="flex items-center gap-3">
                      <span className="h-3 w-3 rounded-full bg-amber-500 shrink-0" />
                      <span className="text-base font-medium">לקוחות במעקב</span>
                    </div>
                    <Badge variant="secondary" className="text-base px-3 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                      {customersLoading ? '...' : yellowCustomers}
                    </Badge>
                  </Link>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Quick Actions */}
        <div>
          <h2 className="text-base font-semibold text-muted-foreground mb-3">פעולות מהירות</h2>
          <div className="grid grid-cols-2 gap-3">
            <Link href="/sales-rep/price-check">
              <Card className="hover:bg-accent/50 transition-colors cursor-pointer h-full">
                <CardContent className="p-5 flex flex-col items-center justify-center gap-3 min-h-[120px]">
                  <div className="h-14 w-14 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <DollarSign className="h-7 w-7 text-blue-600 dark:text-blue-400" />
                  </div>
                  <span className="text-base font-semibold text-center">בדיקת מחיר ומלאי</span>
                </CardContent>
              </Card>
            </Link>

            <Link href="/sales-rep/customers">
              <Card className="hover:bg-accent/50 transition-colors cursor-pointer h-full">
                <CardContent className="p-5 flex flex-col items-center justify-center gap-3 min-h-[120px]">
                  <div className="h-14 w-14 rounded-full bg-purple-500/10 flex items-center justify-center">
                    <Users className="h-7 w-7 text-purple-600 dark:text-purple-400" />
                  </div>
                  <span className="text-base font-semibold text-center">חיפוש לקוח</span>
                </CardContent>
              </Card>
            </Link>

            <Link href="/sales-rep/visits">
              <Card className="hover:bg-accent/50 transition-colors cursor-pointer h-full">
                <CardContent className="p-5 flex flex-col items-center justify-center gap-3 min-h-[120px]">
                  <div className="h-14 w-14 rounded-full bg-amber-500/10 flex items-center justify-center">
                    <ClipboardList className="h-7 w-7 text-amber-600 dark:text-amber-400" />
                  </div>
                  <span className="text-base font-semibold text-center">היסטוריית ביקורים</span>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      </div>

      <SalesRepBottomNav />
    </div>
  )
}
