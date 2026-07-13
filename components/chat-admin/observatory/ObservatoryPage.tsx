'use client'

import React, { useState } from 'react'
import { Radar, Network, BarChart3 } from 'lucide-react'
import DecisionTracer from './DecisionTracer'
import CatalogGraph from './CatalogGraph'
import RuleCorpusAnalytics from './RuleCorpusAnalytics'

const TABS = [
  { key: 'tracer', label: 'Decision Tracer', he: 'עוקב החלטות', icon: Radar },
  { key: 'catalog', label: 'Catalog', he: 'קטלוג', icon: Network },
  { key: 'analytics', label: 'Analytics', he: 'אנליטיקה', icon: BarChart3 },
] as const

export default function ObservatoryPage({ initialQuery = '' }: { initialQuery?: string }) {
  const [tab, setTab] = useState<string>('tracer')
  return (
    <div className="p-4 text-slate-100">
      <div className="mb-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold"><Radar size={18} className="text-sky-400" /> מצפה החלטות זרימה</h1>
        <p className="text-[12px] text-slate-400">דיבאג ויזואלי של החלטות הזרימה — מדוע חוק מסוים נבחר לחלק + רכב.</p>
      </div>
      <div className="mb-3 flex gap-1 border-b border-slate-700">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${tab === t.key ? 'border-sky-400 text-sky-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            <t.icon size={14} /> {t.he}
          </button>
        ))}
      </div>
      {tab === 'tracer' && <DecisionTracer initialQuery={initialQuery} />}
      {tab === 'catalog' && <CatalogGraph />}
      {tab === 'analytics' && <RuleCorpusAnalytics />}
    </div>
  )
}
