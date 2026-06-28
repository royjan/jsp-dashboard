'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter, usePathname } from 'next/navigation'
import { Button } from '@/components/chat-admin/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/chat-admin/ui/table'
import WordMappingForm from './WordMappingForm'
import { Plus, Edit, Trash2, RefreshCw, CheckCircle, XCircle, Square, CheckSquare, Star, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { AdminPagination } from '@/components/chat-admin/shared'
import { logger } from '@/lib/logger'
import { toast } from '@/lib/toast'
import { Modal } from '@/components/chat-admin/ui/Modal'

interface WordMapping {
  id: string
  sourceWord: string
  sourceLanguage: string
  targetWord: string
  targetLanguage: string
  mappingType: 'translation' | 'synonym'
  confidence: number
  usageCount: number
  isActive: boolean
  isDefault: boolean
  category?: string
  createdAt: string
  updatedAt: string
}

interface WordMappingSuggestion {
  id: string
  sourceWord: string
  sourceLanguage: string
  targetWord: string
  targetLanguage: string
  mappingType: 'translation' | 'synonym'
  confidence: number
  evidence: any
  status: 'pending' | 'approved' | 'rejected'
  createdAt: string
}

export default function WordMappingDashboard() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Initialize state from URL params
  const [mappings, setMappings] = useState<WordMapping[]>([])
  const [suggestions, setSuggestions] = useState<WordMappingSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingMapping, setEditingMapping] = useState<WordMapping | null>(null)
  const [search, setSearch] = useState(searchParams.get('search') || searchParams.get('searchSource') || searchParams.get('searchTarget') || '')
  const [searchField, setSearchField] = useState<'all' | 'source' | 'target'>(
    searchParams.get('searchSource') ? 'source' : searchParams.get('searchTarget') ? 'target' : 'all'
  )
  const [languageFilter, setLanguageFilter] = useState<'' | 'en' | 'he' | 'ar' | 'zh'>((searchParams.get('language') as '' | 'en' | 'he' | 'ar' | 'zh') || '')
  const [mappingTypeFilter, setMappingTypeFilter] = useState<'' | 'translation' | 'synonym'>((searchParams.get('type') as '' | 'translation' | 'synonym') || '')
  const [page, setPage] = useState(parseInt(searchParams.get('page') || '1', 10))
  const [total, setTotal] = useState(0)
  const pageSize = 50
  const [clickedWord, setClickedWord] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'sourceWord' | 'targetWord' | 'usageCount' | 'createdAt'>(
    (searchParams.get('sortBy') as 'sourceWord' | 'targetWord' | 'usageCount' | 'createdAt') || 'usageCount'
  )
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(
    (searchParams.get('sortOrder') as 'asc' | 'desc') || 'desc'
  )

  // Update URL when filters change
  const updateUrlParams = useCallback((updates: Record<string, string | number | null>) => {
    const params = new URLSearchParams(searchParams.toString())

    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '' || (key === 'page' && value === 1)) {
        params.delete(key)
      } else {
        params.set(key, String(value))
      }
    })

    const queryString = params.toString()
    const newUrl = queryString ? `${pathname}?${queryString}` : pathname
    router.replace(newUrl, { scroll: false })
  }, [pathname, router, searchParams])

  // Debounced URL update for search
  useEffect(() => {
    const timer = setTimeout(() => {
      const currentSearch = searchParams.get('search') || searchParams.get('searchSource') || searchParams.get('searchTarget') || ''
      if (search !== currentSearch || searchField !== (searchParams.get('searchSource') ? 'source' : searchParams.get('searchTarget') ? 'target' : 'all')) {
        const updates: Record<string, string | null> = {
          search: null,
          searchSource: null,
          searchTarget: null,
          page: null
        }
        if (search) {
          if (searchField === 'source') {
            updates.searchSource = search
          } else if (searchField === 'target') {
            updates.searchTarget = search
          } else {
            updates.search = search
          }
        }
        updateUrlParams(updates)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [search, searchField, searchParams, updateUrlParams])

  // Wrapper functions to update state and URL together
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    setPage(1) // Reset to first page
  }, [])

  const handleSearchFieldChange = useCallback((value: 'all' | 'source' | 'target') => {
    setSearchField(value)
    setPage(1)
  }, [])

  const handleSort = useCallback((column: 'sourceWord' | 'targetWord' | 'usageCount' | 'createdAt') => {
    if (sortBy === column) {
      // Toggle order if same column
      const newOrder = sortOrder === 'asc' ? 'desc' : 'asc'
      setSortOrder(newOrder)
      updateUrlParams({ sortOrder: newOrder })
    } else {
      // New column, default to asc for text, desc for numbers
      const defaultOrder = column === 'usageCount' ? 'desc' : 'asc'
      setSortBy(column)
      setSortOrder(defaultOrder)
      updateUrlParams({ sortBy: column, sortOrder: defaultOrder })
    }
    setPage(1)
  }, [sortBy, sortOrder, updateUrlParams])

  const handleLanguageChange = useCallback((value: '' | 'en' | 'he' | 'ar' | 'zh') => {
    setLanguageFilter(value)
    setPage(1)
    updateUrlParams({ language: value, page: null })
  }, [updateUrlParams])

  const handleMappingTypeChange = useCallback((value: '' | 'translation' | 'synonym') => {
    setMappingTypeFilter(value)
    setPage(1)
    updateUrlParams({ type: value, page: null })
  }, [updateUrlParams])

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage)
    updateUrlParams({ page: newPage })
  }, [updateUrlParams])

  // Bulk operations state
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set())
  const [bulkProcessing, setBulkProcessing] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectModal, setShowRejectModal] = useState(false)

  // Fetch mappings
  useEffect(() => {
    fetchMappings()
  }, [page, search, searchField, languageFilter, mappingTypeFilter, sortBy, sortOrder])

  // Fetch suggestions
  useEffect(() => {
    fetchSuggestions()
  }, [])

  const fetchMappings = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        ...(search && searchField === 'all' && { search }),
        ...(search && searchField === 'source' && { searchSource: search }),
        ...(search && searchField === 'target' && { searchTarget: search }),
        ...(languageFilter && { language: languageFilter }),
        ...(mappingTypeFilter && { mappingType: mappingTypeFilter }),
        sortBy,
        sortOrder
      })

      const response = await fetch(`/api/admin/word-mappings?${params}`)
      const data = await response.json()

      if (response.ok) {
        setMappings(data.items)
        setTotal(data.total)
      } else {
        logger.error('Failed to fetch mappings:', data.error)
      }
    } catch (error) {
      logger.error('Error fetching mappings:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchSuggestions = async () => {
    try {
      const response = await fetch('/api/admin/word-mappings/suggestions')
      const data = await response.json()

      if (response.ok) {
        setSuggestions(data.suggestions)
      }
    } catch (error) {
      logger.error('Error fetching suggestions:', error)
    }
  }

  const handleCreateMapping = () => {
    setEditingMapping(null)
    setShowForm(true)
  }

  const handleEditMapping = (mapping: WordMapping) => {
    setEditingMapping(mapping)
    setShowForm(true)
  }

  const handleDeleteMapping = async (id: string) => {
    if (!confirm('Are you sure you want to delete this mapping?')) {
      return
    }

    try {
      const response = await fetch(`/api/admin/word-mappings/${id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        fetchMappings()
        toast.success('Mapping deleted successfully')
      } else {
        const data = await response.json()
        toast.error(`Failed to delete mapping: ${data.error}`)
      }
    } catch (error) {
      logger.error('Error deleting mapping:', error)
      toast.error('Failed to delete mapping')
    }
  }

  const handleSetDefault = async (id: string) => {
    try {
      const response = await fetch(`/api/admin/word-mappings/${id}/set-default`, {
        method: 'POST'
      })

      if (response.ok) {
        fetchMappings()
        toast.success('Default translation set')
      } else {
        const data = await response.json()
        toast.error(`Failed to set default: ${data.error}`)
      }
    } catch (error) {
      logger.error('Error setting default:', error)
      toast.error('Failed to set default')
    }
  }

  const handleFormClose = (refresh?: boolean) => {
    setShowForm(false)
    setEditingMapping(null)
    if (refresh) {
      fetchMappings()
    }
  }

  const handleApproveSuggestion = async (id: string) => {
    try {
      const response = await fetch(`/api/admin/word-mappings/suggestions/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewedBy: 'admin' })
      })

      if (response.ok) {
        fetchSuggestions()
        fetchMappings()
        toast.success('Suggestion approved')
      } else {
        const data = await response.json()
        toast.error(`Failed to approve suggestion: ${data.error}`)
      }
    } catch (error) {
      logger.error('Error approving suggestion:', error)
      toast.error('Failed to approve suggestion')
    }
  }

  const handleRejectSuggestion = async (id: string) => {
    const reason = prompt('Reason for rejection (optional):')

    try {
      const response = await fetch(`/api/admin/word-mappings/suggestions/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewedBy: 'admin', reason })
      })

      if (response.ok) {
        fetchSuggestions()
        toast.success('Suggestion rejected')
      } else {
        const data = await response.json()
        toast.error(`Failed to reject suggestion: ${data.error}`)
      }
    } catch (error) {
      logger.error('Error rejecting suggestion:', error)
      toast.error('Failed to reject suggestion')
    }
  }

  const handleGenerateSuggestions = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/word-mappings/suggestions', {
        method: 'POST'
      })

      if (response.ok) {
        toast.success('Suggestions generated successfully!')
        fetchSuggestions()
      } else {
        const data = await response.json()
        toast.error(`Failed to generate suggestions: ${data.error}`)
      }
    } catch (error) {
      logger.error('Error generating suggestions:', error)
      toast.error('Failed to generate suggestions')
    } finally {
      setLoading(false)
    }
  }

  const handleWordClick = (word: string) => {
    if (clickedWord === word) {
      // Clear filter if clicking the same word
      setClickedWord(null)
      handleSearchChange('')
    } else {
      // Set filter to this word
      setClickedWord(word)
      handleSearchChange(word)
    }
  }

  // Bulk operations handlers
  const toggleSuggestionSelection = (id: string) => {
    setSelectedSuggestions(prev => {
      const newSet = new Set(prev)
      if (newSet.has(id)) {
        newSet.delete(id)
      } else {
        newSet.add(id)
      }
      return newSet
    })
  }

  const toggleSelectAllSuggestions = () => {
    if (selectedSuggestions.size === suggestions.length) {
      setSelectedSuggestions(new Set())
    } else {
      setSelectedSuggestions(new Set(suggestions.map(s => s.id)))
    }
  }

  const handleBulkApprove = async () => {
    if (selectedSuggestions.size === 0) return

    setBulkProcessing(true)
    try {
      const response = await fetch('/api/admin/word-mappings/suggestions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          ids: Array.from(selectedSuggestions)
        })
      })

      const data = await response.json()

      if (response.ok) {
        toast.success(`Approved ${data.processed} suggestions`)
        setSelectedSuggestions(new Set())
        fetchSuggestions()
        fetchMappings()
      } else {
        toast.error(`Failed to approve: ${data.error}`)
      }
    } catch (error) {
      logger.error('Error in bulk approve:', error)
      toast.error('Failed to approve suggestions')
    } finally {
      setBulkProcessing(false)
    }
  }

  const handleBulkReject = async () => {
    if (selectedSuggestions.size === 0 || !rejectReason.trim()) return

    setBulkProcessing(true)
    try {
      const response = await fetch('/api/admin/word-mappings/suggestions/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject',
          ids: Array.from(selectedSuggestions),
          reason: rejectReason
        })
      })

      const data = await response.json()

      if (response.ok) {
        toast.success(`Rejected ${data.processed} suggestions`)
        setSelectedSuggestions(new Set())
        setRejectReason('')
        setShowRejectModal(false)
        fetchSuggestions()
      } else {
        toast.error(`Failed to reject: ${data.error}`)
      }
    } catch (error) {
      logger.error('Error in bulk reject:', error)
      toast.error('Failed to reject suggestions')
    } finally {
      setBulkProcessing(false)
    }
  }

  // Filter mappings based on clicked word
  const filteredMappings = clickedWord
    ? mappings.filter(m =>
        m.sourceWord.toLowerCase() === clickedWord.toLowerCase() ||
        m.targetWord.toLowerCase() === clickedWord.toLowerCase()
      )
    : mappings

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Action Buttons */}
      <div className="flex justify-end" style={{ gap: '16px' }}>
        <button
          onClick={handleGenerateSuggestions}
          disabled={loading}
          className="flex h-10 items-center gap-2 px-4 text-sm font-medium text-foreground bg-card border border-border rounded-xl hover:bg-accent transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Generate Suggestions
        </button>
        <button
          onClick={handleCreateMapping}
          className="flex h-10 items-center gap-2 px-4 text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <Plus className="w-4 h-4" />
          Add Mapping
        </button>
      </div>

      {/* Content */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {/* Suggestions Section */}
        {suggestions.length > 0 && (
          <div className="bg-card rounded-2xl border border-border" style={{ padding: '28px 32px' }}>
            {/* Header with bulk actions */}
            <div className="flex items-center justify-between" style={{ marginBottom: '24px' }}>
              <div className="flex items-center" style={{ gap: '16px' }}>
                <button
                  onClick={toggleSelectAllSuggestions}
                  className="text-slate-400 hover:text-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-ring rounded"
                  aria-label={selectedSuggestions.size === suggestions.length ? "Deselect all suggestions" : "Select all suggestions"}
                  title={selectedSuggestions.size === suggestions.length ? "Deselect all" : "Select all"}
                >
                  {selectedSuggestions.size === suggestions.length ? (
                    <CheckSquare className="w-5 h-5 text-indigo-400" />
                  ) : (
                    <Square className="w-5 h-5" />
                  )}
                </button>
                <h3 className="text-lg font-semibold text-slate-100">
                  Pending Suggestions ({suggestions.length})
                </h3>
              </div>

              {/* Bulk action buttons */}
              {selectedSuggestions.size > 0 && (
                <div className="flex items-center" style={{ gap: '16px' }}>
                  <span className="text-sm text-slate-400">
                    {selectedSuggestions.size} selected
                  </span>
                  <button
                    onClick={handleBulkApprove}
                    disabled={bulkProcessing}
                    className="flex items-center text-sm font-medium text-white bg-emerald-600 rounded-xl hover:bg-emerald-500 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
                    style={{ gap: '8px', padding: '12px 20px', minHeight: '48px' }}
                  >
                    <CheckCircle className="w-4 h-4" />
                    Approve ({selectedSuggestions.size})
                  </button>
                  <button
                    onClick={() => setShowRejectModal(true)}
                    disabled={bulkProcessing}
                    className="flex items-center text-sm font-medium text-rose-300 border border-rose-500/40 rounded-xl hover:bg-rose-500/15 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-ring"
                    style={{ gap: '8px', padding: '12px 20px', minHeight: '48px' }}
                  >
                    <XCircle className="w-4 h-4" />
                    Reject ({selectedSuggestions.size})
                  </button>
                </div>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {suggestions.map((suggestion) => (
                <div key={suggestion.id} className="flex items-center justify-between bg-white/[0.03] rounded-xl border border-white/10 hover:border-white/20 transition-colors" style={{ padding: '20px 24px' }}>
                  {/* Checkbox */}
                  <button
                    onClick={() => toggleSuggestionSelection(suggestion.id)}
                    className="text-slate-400 hover:text-slate-100 transition-colors mr-4 focus:outline-none focus:ring-2 focus:ring-ring rounded"
                    aria-label={selectedSuggestions.has(suggestion.id) ? "Deselect suggestion" : "Select suggestion"}
                  >
                    {selectedSuggestions.has(suggestion.id) ? (
                      <CheckSquare className="w-5 h-5 text-indigo-400" />
                    ) : (
                      <Square className="w-5 h-5" />
                    )}
                  </button>

                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-slate-100 font-medium" dir="auto">{suggestion.sourceWord}</span>
                      <span className="inline-flex items-center rounded-full bg-white/5 px-2 py-0.5 text-xs font-medium text-slate-300 ring-1 ring-inset ring-white/10">{suggestion.sourceLanguage}</span>
                      <span className="text-slate-500">→</span>
                      <span className="text-slate-100 font-medium" dir="auto">{suggestion.targetWord}</span>
                      <span className="inline-flex items-center rounded-full bg-white/5 px-2 py-0.5 text-xs font-medium text-slate-300 ring-1 ring-inset ring-white/10">{suggestion.targetLanguage}</span>
                      <span className="ml-2 inline-flex items-center rounded-full bg-cyan-500/15 px-2 py-0.5 text-xs font-medium text-cyan-300 ring-1 ring-inset ring-cyan-400/20">
                        {(suggestion.confidence * 100).toFixed(0)}% confident
                      </span>
                    </div>
                    <div className="text-sm text-slate-400 mt-1">
                      {suggestion.evidence?.searchCount && `Searched ${suggestion.evidence.searchCount} times`}
                    </div>
                  </div>
                  <div className="flex" style={{ gap: '12px' }}>
                    <button
                      onClick={() => handleApproveSuggestion(suggestion.id)}
                      className="text-sm font-medium bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                      style={{ padding: '12px 20px', minHeight: '44px' }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleRejectSuggestion(suggestion.id)}
                      className="text-sm font-medium text-foreground bg-card border border-border rounded-xl hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                      style={{ padding: '12px 20px', minHeight: '44px' }}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div dir="ltr" className="bg-card rounded-2xl border border-border" style={{ padding: '20px 24px' }}>
          <div className="flex flex-wrap" style={{ gap: '16px' }}>
            <div className="flex flex-1 min-w-[300px]">
              <select
                value={searchField}
                onChange={(e) => handleSearchFieldChange(e.target.value as 'all' | 'source' | 'target')}
                className="h-10 px-4 bg-input border border-r-0 border-border rounded-l-xl text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring [&>option]:bg-popover [&>option]:text-foreground"
              >
                <option value="all">All</option>
                <option value="source">Source</option>
                <option value="target">Target</option>
              </select>
              <input
                placeholder={`Search ${searchField === 'all' ? 'mappings' : searchField}...`}
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="h-10 flex-1 rounded-l-none rounded-r-xl bg-input border border-border text-foreground placeholder:text-muted-foreground px-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <select
              value={languageFilter}
              onChange={(e) => handleLanguageChange(e.target.value as '' | 'en' | 'he' | 'ar' | 'zh')}
              className="h-10 px-4 bg-input border border-border rounded-xl text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring [&>option]:bg-popover [&>option]:text-foreground"
            >
              <option value="">All Languages</option>
              <option value="en">English</option>
              <option value="he">Hebrew (עברית)</option>
              <option value="zh">Chinese (中文)</option>
            </select>
            <select
              value={mappingTypeFilter}
              onChange={(e) => handleMappingTypeChange(e.target.value as '' | 'translation' | 'synonym')}
              className="h-10 px-4 bg-input border border-border rounded-xl text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring [&>option]:bg-popover [&>option]:text-foreground"
            >
              <option value="">All Types</option>
              <option value="translation">Translation</option>
              <option value="synonym">Synonym</option>
            </select>
          </div>
        </div>

        {/* Mappings Table */}
        <div dir="ltr" className="bg-card rounded-2xl border border-border overflow-hidden">
          <Table className="divide-y divide-white/10">
            <TableHeader className="sticky top-0 z-10 border-white/10 bg-white/[0.04]">
              <TableRow className="border-white/10 bg-transparent hover:bg-transparent hover:translate-y-0 hover:shadow-none">
                <TableHead
                  className="text-xs font-semibold uppercase tracking-wide text-start cursor-pointer hover:bg-white/[0.04] select-none transition-colors"
                  onClick={() => handleSort('sourceWord')}
                >
                  <div className={`flex items-center gap-1 ${sortBy === 'sourceWord' ? 'text-cyan-300' : 'text-slate-400'}`}>
                    Source
                    {sortBy === 'sourceWord' ? (
                      sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 opacity-30" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-start text-slate-400">Language</TableHead>
                <TableHead
                  className="text-xs font-semibold uppercase tracking-wide text-start cursor-pointer hover:bg-white/[0.04] select-none transition-colors"
                  onClick={() => handleSort('targetWord')}
                >
                  <div className={`flex items-center gap-1 ${sortBy === 'targetWord' ? 'text-cyan-300' : 'text-slate-400'}`}>
                    Target
                    {sortBy === 'targetWord' ? (
                      sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 opacity-30" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-start text-slate-400">Language</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-start text-slate-400">Type</TableHead>
                <TableHead
                  className="text-xs font-semibold uppercase tracking-wide text-start cursor-pointer hover:bg-white/[0.04] select-none transition-colors"
                  onClick={() => handleSort('usageCount')}
                >
                  <div className={`flex items-center gap-1 ${sortBy === 'usageCount' ? 'text-cyan-300' : 'text-slate-400'}`}>
                    Usage
                    {sortBy === 'usageCount' ? (
                      sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 opacity-30" />
                    )}
                  </div>
                </TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-start text-slate-400">Status</TableHead>
                <TableHead className="text-xs font-semibold uppercase tracking-wide text-start text-slate-400">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-white/5">
              {loading ? (
                <TableRow className="border-white/10 hover:bg-transparent hover:translate-y-0 hover:shadow-none">
                  <TableCell colSpan={8} className="text-center text-slate-400 py-12">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : mappings.length === 0 ? (
                <TableRow className="border-white/10 hover:bg-transparent hover:translate-y-0 hover:shadow-none">
                  <TableCell colSpan={8} className="text-center text-slate-400 py-12">
                    No mappings found
                  </TableCell>
                </TableRow>
              ) : (
                filteredMappings.map((mapping) => (
                  <TableRow key={mapping.id} className="border-white/10 hover:bg-white/[0.04] hover:translate-y-0 hover:shadow-none transition-colors">
                    <TableCell
                      className="font-medium text-slate-100 text-start cursor-pointer hover:text-cyan-300 transition-colors"
                      onClick={() => handleWordClick(mapping.sourceWord)}
                      title="Click to filter related mappings"
                      dir="auto"
                    >
                      {mapping.sourceWord}
                    </TableCell>
                    <TableCell className="text-start">
                      <span className="inline-flex items-center rounded-full bg-white/5 px-2 py-0.5 text-xs font-medium text-slate-300 ring-1 ring-inset ring-white/10">{mapping.sourceLanguage}</span>
                    </TableCell>
                    <TableCell
                      className="font-medium text-slate-100 text-start cursor-pointer hover:text-cyan-300 transition-colors"
                      onClick={() => handleWordClick(mapping.targetWord)}
                      title="Click to filter related mappings"
                      dir="auto"
                    >
                      {mapping.targetWord}
                    </TableCell>
                    <TableCell className="text-start">
                      <span className="inline-flex items-center rounded-full bg-white/5 px-2 py-0.5 text-xs font-medium text-slate-300 ring-1 ring-inset ring-white/10">{mapping.targetLanguage}</span>
                    </TableCell>
                    <TableCell className="text-start">
                      <span className="inline-flex items-center rounded-full bg-white/5 px-2 py-0.5 text-xs font-medium capitalize text-slate-300 ring-1 ring-inset ring-white/10">{mapping.mappingType}</span>
                    </TableCell>
                    <TableCell className="text-start text-slate-200 tabular-nums">{mapping.usageCount}</TableCell>
                    <TableCell className="text-start">
                      <div className="flex gap-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${mapping.isActive ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/20' : 'bg-rose-500/15 text-rose-300 ring-rose-400/20'}`}>
                          {mapping.isActive ? 'Active' : 'Inactive'}
                        </span>
                        {mapping.isDefault && (
                          <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300 ring-1 ring-inset ring-amber-400/20">
                            <Star className="w-3 h-3 mr-1 fill-current" />
                            Default
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-start">
                      <div className="flex gap-2">
                        {!mapping.isDefault && (
                          <button
                            onClick={() => handleSetDefault(mapping.id)}
                            className="grid place-items-center h-11 w-11 text-amber-300 hover:text-amber-200 hover:bg-amber-500/15 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                            aria-label="Set as default mapping"
                            title="Set as default mapping"
                          >
                            <Star className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => handleEditMapping(mapping)}
                          className="grid place-items-center h-11 w-11 text-cyan-300 hover:text-cyan-200 hover:bg-cyan-500/15 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                          aria-label="Edit mapping"
                          title="Edit mapping"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteMapping(mapping.id)}
                          className="grid place-items-center h-11 w-11 text-rose-300 hover:text-rose-200 hover:bg-rose-500/15 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                          aria-label="Delete mapping"
                          title="Delete mapping"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {/* Pagination */}
          <AdminPagination
            currentPage={page}
            totalPages={Math.ceil(total / pageSize)}
            onPageChange={handlePageChange}
          />
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <WordMappingForm
          mapping={editingMapping}
          onClose={handleFormClose}
        />
      )}

      {/* Bulk Reject Modal */}
      <Modal
        isOpen={showRejectModal}
        onClose={() => {
          setShowRejectModal(false)
          setRejectReason('')
        }}
        title="Reject Suggestions"
      >
        <div className="space-y-4">
          <p className="text-slate-300">
            You are about to reject {selectedSuggestions.size} suggestion(s). Please provide a reason:
          </p>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Enter rejection reason..."
            className="w-full h-24 px-3 py-2 bg-slate-900 border border-white/10 rounded-md text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-ring focus:border-cyan-400/50"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowRejectModal(false)
                setRejectReason('')
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleBulkReject}
              disabled={!rejectReason.trim() || bulkProcessing}
              className="bg-red-600 hover:bg-red-700"
            >
              {bulkProcessing ? 'Rejecting...' : `Reject ${selectedSuggestions.size} Suggestion(s)`}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
