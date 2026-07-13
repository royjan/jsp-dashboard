'use client'

import React, { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Radar, Network, BarChart3 } from 'lucide-react'
import DecisionTracer from './DecisionTracer'
import CatalogGraph from './CatalogGraph'
import RuleCorpusAnalytics from './RuleCorpusAnalytics'
import type { VehicleInputData } from '@/components/chat-admin/SimulatorVehicleInput'

const TABS = [
  { key: 'tracer', label: 'Decision Tracer', he: 'עוקב החלטות', icon: Radar },
  { key: 'catalog', label: 'Catalog', he: 'קטלוג', icon: Network },
  { key: 'analytics', label: 'Analytics', he: 'אנליטיקה', icon: BarChart3 },
] as const

export default function ObservatoryPage({
  initialQuery = '',
  initialTab = 'tracer',
  initialVehicle,
}: {
  initialQuery?: string
  initialTab?: string
  initialVehicle?: VehicleInputData
}) {
  const [tab, setTab] = useState<string>(TABS.some((t) => t.key === initialTab) ? initialTab : 'tracer')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Reflect the active tab in the URL (?tab=...) so the whole window — catalog, tracer,
  // analytics, incl. fullscreen entry point — is a shareable deep link. Preserve any other
  // params already present (q / license_plate / vin / ...).
  const changeTab = (key: string) => {
    setTab(key)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', key)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="p-4 text-slate-100">
      <div className="mb-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold"><Radar size={18} className="text-sky-400" /> מצפה החלטות זרימה</h1>
        <p className="text-[12px] text-slate-400">דיבאג ויזואלי של החלטות הזרימה — מדוע חוק מסוים נבחר לחלק + רכב.</p>
      </div>
      <div className="mb-3 flex gap-1 border-b border-slate-700">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => changeTab(t.key)}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${tab === t.key ? 'border-sky-400 text-sky-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            <t.icon size={14} /> {t.he}
          </button>
        ))}
      </div>
      {tab === 'tracer' && <DecisionTracer initialQuery={initialQuery} initialVehicle={initialVehicle} />}
      {tab === 'catalog' && <CatalogGraph />}
      {tab === 'analytics' && <RuleCorpusAnalytics />}
    </div>
  )
}
