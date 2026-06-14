'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Bell, Plus, Trash2, Power, Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AlertRule {
  id: string
  name: string
  itemCodes: string[] | null
  topN: number | null
  topNMonths: number | null
  thresholdQty: string
  comparator: string
  recipients: string[]
  channel: string
  enabled: boolean
  cooldownHours: number
  createdAt: string
  updatedAt: string
}

export default function AlertsPage() {
  const [rules, setRules] = useState<AlertRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/alerts/rules')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setRules(data.rules || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const toggleEnabled = async (rule: AlertRule) => {
    const prev = rules
    setRules(r =>
      r.map(x => (x.id === rule.id ? { ...x, enabled: !x.enabled } : x)),
    )
    try {
      const res = await fetch(`/api/alerts/rules/${rule.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setRules(prev)
    }
  }

  const deleteRule = async (id: string) => {
    if (!confirm('Delete this rule?')) return
    const prev = rules
    setRules(r => r.filter(x => x.id !== id))
    try {
      const res = await fetch(`/api/alerts/rules/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
    } catch {
      setRules(prev)
    }
  }

  const runNow = async () => {
    try {
      const res = await fetch('/api/cron/check-alerts')
      const data = await res.json()
      alert(
        `Evaluation complete:\n${data.evaluated} firings found\n${data.sent} sent\n${data.failed} failed`,
      )
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : 'unknown'}`)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Stock Alerts</h1>
        </div>
        <div className="flex gap-2">
          <Button onClick={runNow} variant="outline">
            Run Now
          </Button>
          <Button onClick={() => setShowNew(!showNew)}>
            <Plus className="h-4 w-4 me-1" /> New Rule
          </Button>
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="p-4 flex items-center gap-2 text-red-500 text-sm">
            <AlertCircle className="h-4 w-4" /> {error}
          </CardContent>
        </Card>
      )}

      {showNew && (
        <NewRuleForm
          creating={creating}
          setCreating={setCreating}
          onCreated={() => {
            setShowNew(false)
            load()
          }}
        />
      )}

      {rules.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            <Bell className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>No alert rules yet. Create one to get notified when stock runs low.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rules.map(r => (
            <Card
              key={r.id}
              className={cn(!r.enabled && 'opacity-60')}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-semibold truncate">{r.name}</h3>
                      <Badge variant={r.enabled ? 'success' : 'secondary'}>
                        {r.enabled ? 'enabled' : 'disabled'}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground space-y-1">
                      <div>
                        <span className="font-medium">Trigger:</span>{' '}
                        stock {r.comparator} {r.thresholdQty}
                      </div>
                      <div>
                        <span className="font-medium">Target:</span>{' '}
                        {r.itemCodes && r.itemCodes.length > 0
                          ? `${r.itemCodes.length} items (${r.itemCodes.slice(0, 3).join(', ')}${r.itemCodes.length > 3 ? '…' : ''})`
                          : `top ${r.topN} items from last ${r.topNMonths} months`}
                      </div>
                      <div>
                        <span className="font-medium">Recipients:</span>{' '}
                        {r.recipients.join(', ')}
                      </div>
                      <div>
                        <span className="font-medium">Cooldown:</span>{' '}
                        {r.cooldownHours}h
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleEnabled(r)}
                      title={r.enabled ? 'Disable' : 'Enable'}
                    >
                      <Power className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteRule(r.id)}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function NewRuleForm({
  creating,
  setCreating,
  onCreated,
}: {
  creating: boolean
  setCreating: (b: boolean) => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'items' | 'topN'>('topN')
  const [itemCodesText, setItemCodesText] = useState('')
  const [topN, setTopN] = useState(50)
  const [topNMonths, setTopNMonths] = useState(3)
  const [thresholdQty, setThresholdQty] = useState(5)
  const [comparator, setComparator] = useState<'lte' | 'lt' | 'eq'>('lte')
  const [recipientsText, setRecipientsText] = useState('')
  const [cooldownHours, setCooldownHours] = useState(24)

  const submit = async () => {
    if (!name.trim() || !recipientsText.trim()) {
      alert('name and recipients are required')
      return
    }
    setCreating(true)
    const recipients = recipientsText
      .split(/[,;\s]+/)
      .map(s => s.trim())
      .filter(Boolean)
    const itemCodes =
      mode === 'items'
        ? itemCodesText
            .split(/[,;\s]+/)
            .map(s => s.trim().toUpperCase())
            .filter(Boolean)
        : undefined
    try {
      const res = await fetch('/api/alerts/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          itemCodes: mode === 'items' ? itemCodes : undefined,
          topN: mode === 'topN' ? topN : undefined,
          topNMonths: mode === 'topN' ? topNMonths : undefined,
          thresholdQty,
          comparator,
          recipients,
          cooldownHours,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed')
      }
      onCreated()
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : 'unknown'}`)
    } finally {
      setCreating(false)
    }
  }

  const Input = ({ label, ...rest }: any) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        className="h-9 rounded-md border border-input bg-transparent px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        {...rest}
      />
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New Alert Rule</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          label="Name"
          type="text"
          value={name}
          onChange={(e: any) => setName(e.target.value)}
          placeholder="e.g. Top sellers OOS warning"
        />

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-2 block">
            Target items
          </label>
          <div className="flex gap-2 mb-2">
            <Button
              variant={mode === 'topN' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('topN')}
            >
              Top N by sales
            </Button>
            <Button
              variant={mode === 'items' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('items')}
            >
              Specific items
            </Button>
          </div>
          {mode === 'topN' ? (
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Top N"
                type="number"
                value={topN}
                onChange={(e: any) => setTopN(Number(e.target.value))}
              />
              <Input
                label="Look back (months)"
                type="number"
                value={topNMonths}
                onChange={(e: any) => setTopNMonths(Number(e.target.value))}
              />
            </div>
          ) : (
            <textarea
              className="w-full min-h-[80px] rounded-md border border-input bg-transparent p-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Item codes (comma or newline separated)"
              value={itemCodesText}
              onChange={e => setItemCodesText(e.target.value)}
            />
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input
            label="Threshold Qty"
            type="number"
            value={thresholdQty}
            onChange={(e: any) => setThresholdQty(Number(e.target.value))}
          />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              Comparator
            </label>
            <select
              value={comparator}
              onChange={e =>
                setComparator(e.target.value as 'lte' | 'lt' | 'eq')
              }
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              <option value="lte">≤ less or equal</option>
              <option value="lt">&lt; less than</option>
              <option value="eq">= equals</option>
            </select>
          </div>
          <Input
            label="Cooldown (hours)"
            type="number"
            value={cooldownHours}
            onChange={(e: any) => setCooldownHours(Number(e.target.value))}
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Recipients (comma-separated emails)
          </label>
          <textarea
            className="w-full min-h-[60px] rounded-md border border-input bg-transparent p-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="sales@jan.co.il, warehouse@jan.co.il"
            value={recipientsText}
            onChange={e => setRecipientsText(e.target.value)}
          />
        </div>

        <div className="flex justify-end">
          <Button onClick={submit} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create Rule'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
