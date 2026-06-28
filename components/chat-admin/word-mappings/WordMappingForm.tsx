'use client'

import React, { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/chat-admin/ui/dialog'
import { Button } from '@/components/chat-admin/ui/button'
import { Input } from '@/components/chat-admin/ui/input'
import { Label } from '@/components/chat-admin/ui/label'
import { logger } from '@/lib/logger'
import { Loader2, Languages } from 'lucide-react'

type Language = 'en' | 'he' | 'ar' | 'zh'

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
  category?: string
}

export interface InitialData {
  sourceWord?: string
  sourceLanguage?: Language
  targetWord?: string
  targetLanguage?: Language
  mappingType?: 'translation' | 'synonym'
  category?: string
}

interface WordMappingFormProps {
  mapping: WordMapping | null
  onClose: (refresh?: boolean) => void
  initialData?: InitialData
}

export default function WordMappingForm({ mapping, onClose, initialData }: WordMappingFormProps) {
  const [sourceWord, setSourceWord] = useState('')
  const [sourceLanguage, setSourceLanguage] = useState<Language>('he')
  const [targetWord, setTargetWord] = useState('')
  const [targetLanguage, setTargetLanguage] = useState<Language>('en')
  const [mappingType, setMappingType] = useState<'translation' | 'synonym'>('translation')
  const [mappingTypeLocked, setMappingTypeLocked] = useState(false)
  const [category, setCategory] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [loading, setLoading] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [error, setError] = useState('')

  // Load existing mapping data or initialData for new mappings
  useEffect(() => {
    if (mapping) {
      setSourceWord(mapping.sourceWord)
      setSourceLanguage(mapping.sourceLanguage as Language)
      setTargetWord(mapping.targetWord)
      setTargetLanguage(mapping.targetLanguage as Language)
      setMappingType(mapping.mappingType)
      setCategory(mapping.category || '')
      setIsActive(mapping.isActive)
    } else if (initialData) {
      // Pre-fill form with initial data for new mappings
      if (initialData.sourceWord) setSourceWord(initialData.sourceWord)
      if (initialData.sourceLanguage) setSourceLanguage(initialData.sourceLanguage)
      if (initialData.targetWord) setTargetWord(initialData.targetWord)
      if (initialData.targetLanguage) setTargetLanguage(initialData.targetLanguage)
      if (initialData.mappingType) setMappingType(initialData.mappingType)
      if (initialData.category) setCategory(initialData.category)
    }
  }, [mapping, initialData])

  // Auto-detect mapping type based on languages and words
  useEffect(() => {
    // Same language = must be synonym
    if (sourceLanguage === targetLanguage) {
      setMappingType('synonym')
      setMappingTypeLocked(true)
    }
    // Same word (case-insensitive) = must be synonym
    else {
      const srcNorm = sourceWord.trim().toLowerCase()
      const tgtNorm = targetWord.trim().toLowerCase()

      if (srcNorm && tgtNorm && srcNorm === tgtNorm) {
        setMappingType('synonym')
        setMappingTypeLocked(true)
      } else {
        // Different languages, different words = translation
        setMappingType('translation')
        setMappingTypeLocked(false)
      }
    }
  }, [sourceLanguage, targetLanguage, sourceWord, targetWord])

  // Translate using LLM with chain support (also handles synonym lookup via pivot)
  const handleTranslate = async () => {
    if (!sourceWord.trim()) {
      setError('Enter a source word to translate')
      return
    }

    try {
      setTranslating(true)
      setError('')

      const response = await fetch('/api/admin/word-mappings/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceWord: sourceWord.trim(),
          sourceLanguage,
          targetLanguage
        })
      })

      const data = await response.json()

      if (response.ok && data.translation) {
        setTargetWord(data.translation)
        // Show info about source (chain vs llm)
        if (data.source === 'chain') {
          setError('') // Clear any errors, translation found via synonym chain
        }
      } else {
        setError(data.error || 'Translation failed')
      }
    } catch (err: any) {
      logger.error('Translation error:', err)
      setError('Translation failed')
    } finally {
      setTranslating(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // Validation
    if (!sourceWord.trim()) {
      setError('Source word is required')
      return
    }

    if (!targetWord.trim()) {
      setError('Target word is required')
      return
    }

    // Validate mapping logic
    if (mappingType === 'translation' && sourceLanguage === targetLanguage) {
      setError('Translation mappings must be between different languages')
      return
    }

    if (mappingType === 'synonym' && sourceLanguage !== targetLanguage) {
      setError('Synonym mappings must be in the same language')
      return
    }

    try {
      setLoading(true)

      const url = mapping
        ? `/api/admin/word-mappings/${mapping.id}`
        : '/api/admin/word-mappings'

      const method = mapping ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceWord: sourceWord.trim(),
          sourceLanguage,
          targetWord: targetWord.trim(),
          targetLanguage,
          mappingType,
          category: category.trim() || undefined,
          isActive,
          createdBy: 'admin'
        })
      })

      const data = await response.json()

      if (response.ok) {
        onClose(true) // Close and refresh
      } else {
        setError(data.error || 'Failed to save mapping')
      }
    } catch (error: any) {
      logger.error('Error saving mapping:', error)
      setError('Failed to save mapping')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] bg-slate-900 text-slate-100 border-white/10 p-0 overflow-y-auto">
        <div className="p-6 pb-0">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-lg text-slate-100">{mapping ? 'Edit Word Mapping' : 'Create Word Mapping'}</DialogTitle>
            <DialogDescription className="text-slate-400 mt-1 text-sm">
              {mappingType === 'translation'
                ? 'Map a word/phrase from one language to another'
                : 'Link synonyms in the same language'}
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="px-6 pb-6">
          {/* Source Word Section */}
          <div
            className="rounded-xl bg-white/[0.03] border border-white/10"
            style={{
              padding: '16px',
              marginBottom: '16px'
            }}
          >
            <h3 className="text-slate-200" style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>
              Source Term
            </h3>
            <div className="grid grid-cols-2" style={{ gap: '16px' }}>
              <div>
                <Label htmlFor="sourceWord" className="text-slate-400" style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                  Word/Phrase <span style={{ color: '#f87171' }}>*</span>
                </Label>
                <Input
                  id="sourceWord"
                  dir="auto"
                  value={sourceWord}
                  onChange={(e) => setSourceWord(e.target.value)}
                  placeholder="e.g., פילטר שמן"
                  className="bg-white/5 border border-white/10 text-slate-100 placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-cyan-500/40"
                  style={{ height: '40px', fontSize: '14px' }}
                  required
                />
              </div>
              <div>
                <Label htmlFor="sourceLanguage" className="text-slate-400" style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                  Language <span style={{ color: '#f87171' }}>*</span>
                </Label>
                <select
                  id="sourceLanguage"
                  value={sourceLanguage}
                  onChange={(e) => setSourceLanguage(e.target.value as Language)}
                  className="w-full rounded-md bg-white/5 border border-white/10 text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-400/50 [&>option]:bg-slate-900 [&>option]:text-slate-100"
                  style={{ height: '40px', fontSize: '14px', padding: '0 12px' }}
                  required
                >
                  <option value="he">Hebrew (עברית)</option>
                  <option value="en">English</option>
                  <option value="zh">Chinese (中文)</option>
                </select>
              </div>
            </div>

            {/* Translate Button */}
            <div style={{ marginTop: '12px' }}>
              <button
                type="button"
                onClick={handleTranslate}
                disabled={translating || !sourceWord.trim()}
                className="flex items-center text-sm font-medium text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded-xl hover:bg-cyan-500/20 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                style={{ gap: '10px', padding: '14px 20px', minHeight: '52px' }}
              >
                {translating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Languages className="w-4 h-4" />
                )}
                {translating
                  ? 'Searching...'
                  : sourceLanguage === targetLanguage
                    ? 'Find Synonym via Pivot'
                    : 'Translate to Target'}
              </button>
            </div>
          </div>

          {/* Arrow Indicator */}
          <div className="flex justify-center" style={{ marginBottom: '16px' }}>
            <div
              className="rounded-full flex items-center justify-center bg-white/[0.03] border border-white/10"
              style={{ width: '36px', height: '36px' }}
            >
              <span className="text-cyan-400" style={{ fontSize: '16px' }}>↓</span>
            </div>
          </div>

          {/* Target Word Section */}
          <div
            className="rounded-xl bg-white/[0.03] border border-white/10"
            style={{
              padding: '16px',
              marginBottom: '16px'
            }}
          >
            <h3 className="text-slate-200" style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>
              Target Term
            </h3>
            <div className="grid grid-cols-2" style={{ gap: '16px' }}>
              <div>
                <Label htmlFor="targetWord" className="text-slate-400" style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                  Word/Phrase <span style={{ color: '#f87171' }}>*</span>
                </Label>
                <Input
                  id="targetWord"
                  dir="auto"
                  value={targetWord}
                  onChange={(e) => setTargetWord(e.target.value)}
                  placeholder="e.g., oil filter"
                  className="bg-white/5 border border-white/10 text-slate-100 placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-cyan-500/40"
                  style={{ height: '40px', fontSize: '14px' }}
                  required
                />
              </div>
              <div>
                <Label htmlFor="targetLanguage" className="text-slate-400" style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                  Language <span style={{ color: '#f87171' }}>*</span>
                </Label>
                <select
                  id="targetLanguage"
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value as Language)}
                  className="w-full rounded-md bg-white/5 border border-white/10 text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-400/50 [&>option]:bg-slate-900 [&>option]:text-slate-100"
                  style={{ height: '40px', fontSize: '14px', padding: '0 12px' }}
                  required
                >
                  <option value="en">English</option>
                  <option value="he">Hebrew (עברית)</option>
                  <option value="zh">Chinese (中文)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Mapping Details */}
          <div
            className="rounded-xl bg-white/[0.03] border border-white/10"
            style={{
              padding: '16px',
              marginBottom: '16px'
            }}
          >
            <h3 className="text-slate-200" style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>
              Mapping Details
            </h3>
            <div className="grid grid-cols-2" style={{ gap: '16px' }}>
              <div>
                <Label htmlFor="mappingType" className="text-slate-400" style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                  Mapping Type <span style={{ color: '#f87171' }}>*</span>
                </Label>
                <select
                  id="mappingType"
                  value={mappingType}
                  onChange={(e) => setMappingType(e.target.value as 'translation' | 'synonym')}
                  className="w-full rounded-md bg-white/5 border border-white/10 text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-400/50 disabled:opacity-60 [&>option]:bg-slate-900 [&>option]:text-slate-100"
                  style={{ height: '40px', fontSize: '14px', padding: '0 12px' }}
                  required
                  disabled={mappingTypeLocked}
                >
                  <option value="translation">Translation (Cross-language)</option>
                  <option value="synonym">Synonym (Same language)</option>
                </select>
                <p className="text-slate-500" style={{ fontSize: '11px', marginTop: '8px' }}>
                  {mappingTypeLocked
                    ? sourceLanguage === targetLanguage
                      ? 'Auto-detected: Same language = Synonym'
                      : 'Auto-detected: Same word = Synonym'
                    : mappingType === 'translation'
                    ? 'Maps between languages (e.g., Hebrew → English)'
                    : 'Links synonyms (e.g., bonnet → hood)'}
                </p>
              </div>
              <div>
                <Label htmlFor="category" className="text-slate-400" style={{ fontSize: '12px', display: 'block', marginBottom: '6px' }}>
                  Category (Optional)
                </Label>
                <Input
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g., filters, brakes"
                  className="bg-white/5 border border-white/10 text-slate-100 placeholder:text-slate-500 focus-visible:ring-2 focus-visible:ring-cyan-500/40"
                  style={{ height: '40px', fontSize: '14px' }}
                />
              </div>
            </div>

            {mapping && (
              <div className="border-t border-white/10" style={{ paddingTop: '12px', marginTop: '12px' }}>
                <div className="flex items-center" style={{ gap: '10px' }}>
                  <input
                    id="isActive"
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    style={{ width: '16px', height: '16px' }}
                    className="rounded border-white/20 bg-white/5 accent-indigo-500"
                  />
                  <Label htmlFor="isActive" className="text-slate-400" style={{ fontSize: '12px' }}>
                    Active (mapping will be used in searches)
                  </Label>
                </div>
              </div>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div
              className="rounded-lg bg-rose-500/15 border border-rose-400/30"
              style={{ padding: '12px', marginBottom: '12px' }}
            >
              <p className="text-rose-300" style={{ fontSize: '13px' }}>{error}</p>
            </div>
          )}

          {/* Info Box */}
          <div
            className="rounded-lg bg-cyan-500/10 border border-cyan-400/30"
            style={{ padding: '12px', marginBottom: '16px' }}
          >
            <p className="text-cyan-200" style={{ fontSize: '12px' }}>
              <strong>Tip:</strong> {mappingType === 'translation'
                ? ' Translations map Hebrew terms to canonical English terms. Example: "פילטר שמן" → "oil filter"'
                : ' Synonyms expand searches with alternate terms. Example: "bonnet" ↔ "hood"'}
            </p>
          </div>

          <DialogFooter className="border-t border-white/10" style={{ paddingTop: '16px', gap: '16px' }}>
            <Button type="button" variant="outline" onClick={() => onClose()} disabled={loading} className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:text-slate-100" style={{ padding: '14px 24px', minHeight: '52px' }}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading} className="rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-500/30 ring-1 ring-inset ring-white/20" style={{ padding: '14px 28px', minHeight: '52px' }}>
              {loading ? 'Saving...' : mapping ? 'Update Mapping' : 'Create Mapping'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
