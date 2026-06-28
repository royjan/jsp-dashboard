'use client'

import { useState, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Search, Link2, Unlink, CheckCircle, ExternalLink, Filter, ArrowUp, ArrowDown, ArrowUpDown, X } from 'lucide-react'

type StatusKey = 'exact' | 'mg' | 'linked' | 'unmatched'
type SortField = 'code' | 'brand' | 'status'

interface CatalogItem {
  item_number: string
  description: string
  hebrew_description: string | null
  brand: string | null
  status: StatusKey
  finansit_code: string | null
  finansit_name: string | null
  link_id: string | null
  notes: string | null
}

interface Stats {
  exact: number
  mg: number
  linked: number
  unmatched: number
}

interface FinansitItem {
  code: string
  name: string
}

const STATUS_LABELS: Record<StatusKey, string> = {
  exact: 'קוד זהה',
  mg: 'קוד MG',
  linked: 'מקושר',
  unmatched: 'לא נמצא',
}

const STATUS_BADGE: Record<StatusKey, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  exact: { label: 'קוד זהה', variant: 'default' },
  mg: { label: 'קוד MG', variant: 'outline' },
  linked: { label: 'מקושר', variant: 'secondary' },
  unmatched: { label: 'לא נמצא', variant: 'destructive' },
}

function useDebounceLocal(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handler = useCallback((v: string) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setDebounced(v), delay)
  }, [delay])
  return { debounced, handler }
}

/** Excel-style column filter: a funnel button opening a multi-select checkbox menu (with counts). */
function FilterMenu({ options, selected, onChange }: {
  options: { value: string; label: string; count?: number }[]
  selected: string[]
  onChange: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const active = selected.length > 0
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v])
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`rounded p-1 transition-colors hover:bg-muted ${active ? 'text-primary' : 'text-muted-foreground'}`}
        title="סנן"
      >
        <Filter className="h-3.5 w-3.5" fill={active ? 'currentColor' : 'none'} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full z-50 mt-1 w-48 rounded-lg border bg-popover p-1 text-right shadow-lg" style={{ insetInlineStart: 0 }}>
            <div className="flex items-center justify-between px-2 py-1">
              <button className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40" onClick={() => onChange([])} disabled={!active}>נקה</button>
              <span className="text-xs font-medium text-muted-foreground">סנן</span>
            </div>
            <div className="max-h-60 overflow-y-auto">
              {options.length === 0 && <div className="px-2 py-2 text-xs text-muted-foreground">אין ערכים</div>}
              {options.map(o => (
                <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} className="accent-primary" />
                  <span className="flex-1">{o.label}</span>
                  {o.count !== undefined && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">{o.count.toLocaleString()}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </span>
  )
}

export default function CatalogLinksPage() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<StatusKey[]>(['unmatched'])
  const [brandFilter, setBrandFilter] = useState<string[]>([])
  const [sort, setSort] = useState<{ field: SortField | null; dir: 'asc' | 'desc' }>({ field: null, dir: 'desc' })
  const [page, setPage] = useState(1)
  const [searchRaw, setSearchRaw] = useState('')
  const { debounced: search, handler: onSearchChange } = useDebounceLocal('', 400)

  // Link dialog state
  const [linkTarget, setLinkTarget] = useState<CatalogItem | null>(null)
  const [finansitSearch, setFinansitSearch] = useState('')
  const { debounced: finansitSearchDebounced, handler: onFinansitSearchChange } = useDebounceLocal('', 300)
  const [notes, setNotes] = useState('')

  const statusParam = statusFilter.length ? [...statusFilter].sort().join(',') : 'all'
  const brandParam = [...brandFilter].sort().join(',')

  const { data, isLoading } = useQuery({
    queryKey: ['catalog-links', statusParam, brandParam, sort.field, sort.dir, search, page],
    queryFn: async () => {
      const params = new URLSearchParams({ status: statusParam, page: String(page), limit: '50' })
      if (brandParam) params.set('brand', brandParam)
      if (search) params.set('search', search)
      if (sort.field) { params.set('sort', sort.field); params.set('dir', sort.dir) }
      const res = await fetch(`/api/catalog-links?${params}`)
      return res.json() as Promise<{ items: CatalogItem[]; total: number; statusCounts: Stats; brandCounts: Record<string, number>; brands: string[] }>
    },
    placeholderData: (prev) => prev,
  })

  const { data: finansitResults, isLoading: finansitLoading } = useQuery({
    queryKey: ['finansit-search', finansitSearchDebounced],
    queryFn: async () => {
      if (!finansitSearchDebounced) return []
      const res = await fetch(`/api/search?q=${encodeURIComponent(finansitSearchDebounced)}`)
      const d = await res.json()
      return (d.items ?? []).slice(0, 12) as FinansitItem[]
    },
    enabled: !!finansitSearchDebounced,
  })

  const linkMutation = useMutation({
    mutationFn: async ({ partly_item_number, finansit_code, notes }: { partly_item_number: string; finansit_code: string; notes: string }) => {
      const res = await fetch('/api/catalog-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partly_item_number, finansit_code, notes }),
      })
      if (!res.ok) throw new Error('Failed to link')
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['catalog-links'] })
      setLinkTarget(null)
      setFinansitSearch('')
      setNotes('')
    },
  })

  const unlinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      const res = await fetch(`/api/catalog-links/${linkId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to unlink')
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['catalog-links'] }),
  })

  const stats = data?.statusCounts
  const brandCounts = data?.brandCounts ?? {}
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / 50)
  const availableBrands: string[] = data?.brands ?? []

  const toggleStatus = (s: StatusKey) => {
    setStatusFilter(prev => (prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]))
    setPage(1)
  }
  const handleSort = (field: SortField) => {
    setSort(s => (s.field === field ? { field, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { field, dir: 'asc' }))
    setPage(1)
  }
  const clearFilters = () => { setStatusFilter([]); setBrandFilter([]); setSearchRaw(''); onSearchChange(''); setPage(1) }
  const anyFilter = statusFilter.length > 0 || brandFilter.length > 0 || !!search

  const SortHead = ({ label, field, filter }: { label: string; field?: SortField; filter?: React.ReactNode }) => {
    const isActive = field && sort.field === field
    return (
      <th className="px-4 py-3 text-right font-medium">
        <span className="inline-flex items-center gap-1">
          {field ? (
            <button onClick={() => handleSort(field)} className="inline-flex items-center gap-1 hover:text-foreground">
              {label}
              {isActive ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
            </button>
          ) : (
            <span>{label}</span>
          )}
          {filter}
        </span>
      </th>
    )
  }

  return (
    <div className="p-6 space-y-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold">חיבורי קטלוג</h1>
        <p className="text-muted-foreground text-sm mt-1">
          חלקים מקטלוג Partly — קשר חלקים שאינם בפינאנסיט לקוד מקביל
        </p>
      </div>

      {stats && stats.unmatched > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-center gap-3">
          <span className="text-lg">⚠️</span>
          <span>
            <span className="font-bold">{stats.unmatched.toLocaleString('he-IL')} חלקים</span> ממתינים לקישור —
            כל קישור שתשלים יופיע מיד בפורטל הלקוח עם מחיר ומלאי.
          </span>
        </div>
      )}

      {/* Stats — click a card to toggle that status filter */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {([
            ['exact', stats.exact, 'text-green-600', 'קוד זהה בפינאנסיט'],
            ['mg', stats.mg, 'text-teal-600', 'קוד MG (תחילית MG)'],
            ['linked', stats.linked, 'text-blue-600', 'מקושרים ידנית'],
            ['unmatched', stats.unmatched, 'text-red-600', 'לא נמצאו בפינאנסיט'],
          ] as [StatusKey, number, string, string][]).map(([key, count, color, label]) => (
            <div
              key={key}
              className={`rounded-lg border p-4 cursor-pointer transition-colors ${statusFilter.includes(key) ? 'bg-primary/10 border-primary' : 'hover:bg-muted'}`}
              onClick={() => toggleStatus(key)}
            >
              <div className={`text-2xl font-bold ${color}`}>{count.toLocaleString()}</div>
              <div className="text-sm text-muted-foreground mt-1">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Search + active-filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchRaw}
            onChange={e => { setSearchRaw(e.target.value); onSearchChange(e.target.value); setPage(1) }}
            placeholder="חפש לפי קוד, תיאור..."
            className="pr-9"
          />
        </div>
        {brandFilter.map(b => (
          <Badge key={b} variant="secondary" className="gap-1 cursor-pointer" onClick={() => setBrandFilter(prev => prev.filter(x => x !== b))}>
            {b} <X className="h-3 w-3" />
          </Badge>
        ))}
        {statusFilter.map(s => (
          <Badge key={s} variant="outline" className="gap-1 cursor-pointer" onClick={() => toggleStatus(s)}>
            {STATUS_LABELS[s]} <X className="h-3 w-3" />
          </Badge>
        ))}
        {anyFilter && (
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={clearFilters}>נקה הכל</Button>
        )}
        <span className="text-xs text-muted-foreground ms-auto">{total.toLocaleString()} תוצאות</span>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <SortHead label="קוד Partly" field="code" />
              <SortHead
                label="מותג"
                field="brand"
                filter={<FilterMenu options={availableBrands.map(b => ({ value: b, label: b, count: brandCounts[b] ?? 0 }))} selected={brandFilter} onChange={v => { setBrandFilter(v); setPage(1) }} />}
              />
              <SortHead label="תיאור עברית" />
              <th className="px-4 py-3 text-right font-medium hidden md:table-cell">תיאור אנגלית</th>
              <SortHead
                label="סטטוס"
                field="status"
                filter={<FilterMenu options={(['exact', 'mg', 'linked', 'unmatched'] as StatusKey[]).map(s => ({ value: s, label: STATUS_LABELS[s], count: stats?.[s] ?? 0 }))} selected={statusFilter} onChange={v => { setStatusFilter(v as StatusKey[]); setPage(1) }} />}
              />
              <SortHead label="קוד פינאנסיט" />
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading && (
              <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">טוען...</td></tr>
            )}
            {!isLoading && (!data?.items?.length) && (
              <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">אין תוצאות</td></tr>
            )}
            {data?.items?.map(item => (
              <tr key={item.item_number} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-mono text-xs">{item.item_number}</td>
                <td className="px-4 py-3">
                  {item.brand
                    ? item.brand.split(', ').map(b => (
                        <span key={b} className="me-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">{b}</span>
                      ))
                    : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-4 py-3">{item.hebrew_description || '—'}</td>
                <td className="px-4 py-3 text-muted-foreground hidden md:table-cell text-xs">{item.description}</td>
                <td className="px-4 py-3">
                  <Badge variant={STATUS_BADGE[item.status].variant} className="text-xs">
                    {STATUS_BADGE[item.status].label}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {item.finansit_code ? (
                    <div className="flex items-center gap-2">
                      <a
                        href={`/items/${item.finansit_code}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-primary hover:underline flex items-center gap-1"
                      >
                        {item.finansit_code}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      {item.finansit_name && (
                        <span className="text-xs text-muted-foreground truncate max-w-[140px]">{item.finansit_name}</span>
                      )}
                    </div>
                  ) : '—'}
                </td>
                <td className="px-4 py-3 text-left">
                  {item.status === 'unmatched' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => { setLinkTarget(item); setFinansitSearch(''); setNotes(item.notes ?? '') }}
                    >
                      <Link2 className="h-3 w-3" />
                      קשר
                    </Button>
                  )}
                  {item.status === 'linked' && item.link_id && (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1"
                        onClick={() => { setLinkTarget(item); setFinansitSearch(item.finansit_code ?? ''); onFinansitSearchChange(item.finansit_code ?? ''); setNotes(item.notes ?? '') }}
                      >
                        <Link2 className="h-3 w-3" />
                        ערוך
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={() => item.link_id && unlinkMutation.mutate(item.link_id)}
                      >
                        <Unlink className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  {(item.status === 'exact' || item.status === 'mg') && (
                    <CheckCircle className={`h-4 w-4 mx-auto ${item.status === 'mg' ? 'text-teal-500' : 'text-green-500'}`} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {((page - 1) * 50 + 1).toLocaleString()}–{Math.min(page * 50, total).toLocaleString()} מתוך {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>הקודם</Button>
            <Button size="sm" variant="outline" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>הבא</Button>
          </div>
        </div>
      )}

      {/* Link dialog */}
      <Dialog open={!!linkTarget} onOpenChange={open => !open && setLinkTarget(null)}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right">קשר לפינאנסיט</DialogTitle>
          </DialogHeader>
          {linkTarget && (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
                <div className="font-mono font-medium">{linkTarget.item_number}</div>
                <div>{linkTarget.hebrew_description}</div>
                <div className="text-muted-foreground text-xs">{linkTarget.description}</div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">חפש קוד פינאנסיט</label>
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={finansitSearch}
                    onChange={e => { setFinansitSearch(e.target.value); onFinansitSearchChange(e.target.value) }}
                    placeholder="קוד או שם חלק..."
                    className="pr-9"
                    autoFocus
                  />
                </div>
                {finansitLoading && <p className="text-xs text-muted-foreground">מחפש...</p>}
                {finansitResults && finansitResults.length > 0 && (
                  <div className="border rounded-lg divide-y max-h-48 overflow-y-auto">
                    {finansitResults.map(fi => (
                      <button
                        key={fi.code}
                        className="w-full text-right px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between gap-2"
                        onClick={() => {
                          linkMutation.mutate({
                            partly_item_number: linkTarget.item_number,
                            finansit_code: fi.code,
                            notes,
                          })
                        }}
                      >
                        <span className="text-muted-foreground truncate">{fi.name}</span>
                        <span className="font-mono text-xs shrink-0">{fi.code}</span>
                      </button>
                    ))}
                  </div>
                )}
                {finansitSearchDebounced && finansitResults?.length === 0 && !finansitLoading && (
                  <p className="text-xs text-muted-foreground">לא נמצאו תוצאות</p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">הערות (אופציונלי)</label>
                <Input
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="למה הקישור הזה?"
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
