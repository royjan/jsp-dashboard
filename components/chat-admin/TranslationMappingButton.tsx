'use client'

import React, { useState } from 'react'
import { Edit2, Check, Database } from 'lucide-react'
import WordMappingForm from './word-mappings/WordMappingForm'

interface TranslationMappingButtonProps {
  original: string          // Hebrew term
  english: string           // Current translation
  source?: 'word_mapping' | 'llm' | 'original'
  onSaved?: () => void
}

/**
 * Admin-only button to save/edit word mappings directly from search results.
 * Shows different icons based on translation source:
 * - word_mapping: checkmark (already saved)
 * - llm: edit icon (can be saved)
 * - original: edit icon (needs translation)
 */
export default function TranslationMappingButton({
  original,
  english,
  source,
  onSaved
}: TranslationMappingButtonProps) {
  const [showForm, setShowForm] = useState(false)

  // If already from word mapping, show as saved
  const isSaved = source === 'word_mapping'

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowForm(true)
  }

  const handleClose = (refresh?: boolean) => {
    setShowForm(false)
    if (refresh && onSaved) {
      onSaved()
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        className="translation-mapping-button"
        title={isSaved ? 'Edit word mapping' : 'Save as word mapping'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '20px',
          height: '20px',
          marginLeft: '4px',
          padding: '0',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          backgroundColor: isSaved ? 'rgba(34, 197, 94, 0.15)' : 'rgba(99, 102, 241, 0.15)',
          color: isSaved ? 'rgb(34, 197, 94)' : 'rgb(99, 102, 241)',
          transition: 'all 0.2s'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = isSaved
            ? 'rgba(34, 197, 94, 0.25)'
            : 'rgba(99, 102, 241, 0.25)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = isSaved
            ? 'rgba(34, 197, 94, 0.15)'
            : 'rgba(99, 102, 241, 0.15)'
        }}
      >
        {isSaved ? (
          <Database size={12} />
        ) : (
          <Edit2 size={12} />
        )}
      </button>

      {showForm && (
        <WordMappingForm
          mapping={null}
          onClose={handleClose}
          initialData={{
            sourceWord: original,
            sourceLanguage: 'he',
            targetWord: english,
            targetLanguage: 'en',
            mappingType: 'translation'
          }}
        />
      )}
    </>
  )
}
