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
import { Search, Link2, Unlink, CheckCircle, ExternalLink } from 'lucide-react'
type Status = 'all' | 'exact' | 'mg' | 'linked' | 'unmatched'

interface CatalogItem {
  item_number: string
  description: string
  hebrew_description: string | null
  status: 'exact' | 'mg' | 'linked' | 'unmatched'
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

const STATUS_LABELS: Record<Status, string> = {
  all: 'הכל',
  exact: 'קוד זהה',
  mg: 'קוד MG',
  linked: 'מקושר',
  unmatched: 'לא נמצא',
}

const STATUS_BADGE: Record<CatalogItem['status'], { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
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

export default function CatalogLinksPage() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<Status>('unmatched')
  const [page, setPage] = useState(1)
  const [searchRaw, setSearchRaw] = useState('')
  const { debounced: search, handler: onSearchChange } = useDebounceLocal('', 400)

  // Link dialog state
  const [linkTarget, setLinkTarget] = useState<CatalogItem | null>(null)
  const [finansitSearch, setFinansitSearch] = useState('')
  const { debounced: finansitSearchDebounced, handler: onFinansitSearchChange } = useDebounceLocal('', 300)
  const [notes, setNotes] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['catalog-links', status, search, page],
    queryFn: async () => {
      const params = new URLSearchParams({ status, page: String(page), limit: '50' })
      if (search) params.set('search', search)
      const res = await fetch(`/api/catalog-links?${params}`)
      return res.json() as Promise<{ items: CatalogItem[]; total: number; stats: Stats }>
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

  const stats = data?.stats
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / 50)

  const handleStatusChange = (s: Status) => {
    setStatus(s)
    setPage(1)
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

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div
            className={`rounded-lg border p-4 cursor-pointer transition-colors ${status === 'exact' ? 'bg-primary/10 border-primary' : 'hover:bg-muted'}`}
            onClick={() => handleStatusChange('exact')}
          >
            <div className="text-2xl font-bold text-green-600">{stats.exact.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground mt-1">קוד זהה בפינאנסיט</div>
          </div>
          <div
            className={`rounded-lg border p-4 cursor-pointer transition-colors ${status === 'mg' ? 'bg-primary/10 border-primary' : 'hover:bg-muted'}`}
            onClick={() => handleStatusChange('mg')}
          >
            <div className="text-2xl font-bold text-teal-600">{stats.mg.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground mt-1">קוד MG (תחילית MG)</div>
          </div>
          <div
            className={`rounded-lg border p-4 cursor-pointer transition-colors ${status === 'linked' ? 'bg-primary/10 border-primary' : 'hover:bg-muted'}`}
            onClick={() => handleStatusChange('linked')}
          >
            <div className="text-2xl font-bold text-blue-600">{stats.linked.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground mt-1">מקושרים ידנית</div>
          </div>
          <div
            className={`rounded-lg border p-4 cursor-pointer transition-colors ${status === 'unmatched' ? 'bg-primary/10 border-primary' : 'hover:bg-muted'}`}
            onClick={() => handleStatusChange('unmatched')}
          >
            <div className="text-2xl font-bold text-red-600">{stats.unmatched.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground mt-1">לא נמצאו בפינאנסיט</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 border rounded-lg p-1">
          {(['all', 'exact', 'mg', 'linked', 'unmatched'] as Status[]).map(s => (
            <button
              key={s}
              onClick={() => handleStatusChange(s)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                status === s ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchRaw}
            onChange={e => {
              setSearchRaw(e.target.value)
              onSearchChange(e.target.value)
              setPage(1)
            }}
            placeholder="חפש לפי קוד, תיאור..."
            className="pr-9"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-right px-4 py-3 font-medium">קוד Partly</th>
              <th className="text-right px-4 py-3 font-medium">תיאור עברית</th>
              <th className="text-right px-4 py-3 font-medium hidden md:table-cell">תיאור אנגלית</th>
              <th className="text-right px-4 py-3 font-medium">סטטוס</th>
              <th className="text-right px-4 py-3 font-medium">קוד פינאנסיט</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading && (
              <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">טוען...</td></tr>
            )}
            {!isLoading && (!data?.items?.length) && (
              <tr><td colSpan={6} className="text-center py-12 text-muted-foreground">אין תוצאות</td></tr>
            )}
            {data?.items?.map(item => (
              <tr key={item.item_number} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-mono text-xs">{item.item_number}</td>
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
