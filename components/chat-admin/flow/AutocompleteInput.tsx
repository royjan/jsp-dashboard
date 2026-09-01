'use client'

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export interface AutocompleteItem {
  /** What gets written into the field when picked. */
  value: string
  /** Shown in the dropdown; defaults to value. */
  label?: string
  /** Extra text the query also matches against (e.g. the car brand for a model). */
  search?: string
}

interface AutocompleteInputProps {
  value: string
  onChange: (value: string) => void
  suggestions?: string[]
  /** Structured alternative to `suggestions` — takes precedence when given. */
  items?: AutocompleteItem[]
  placeholder: string
  className?: string
  id?: string  // Add unique ID prop
}

export default function AutocompleteInput({
  value,
  onChange,
  suggestions,
  items,
  placeholder,
  className = '',
  id
}: AutocompleteInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filteredSuggestions = useMemo<AutocompleteItem[]>(() => {
    const all: AutocompleteItem[] =
      items ?? (suggestions || []).filter(Boolean).map(s => ({ value: s }))
    if (!value) return all
    const q = value.toLowerCase()
    return all.filter(item =>
      item.value.toLowerCase().includes(q) ||
      (item.search && item.search.toLowerCase().includes(q))
    )
  }, [value, suggestions, items])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    onChange(newValue)
    setShowSuggestions(true)
  }

  const handleSuggestionClick = (suggestion: AutocompleteItem) => {
    onChange(suggestion.value)
    setShowSuggestions(false)
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={value}
        onChange={handleInputChange}
        onFocus={() => setShowSuggestions(true)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                   bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100
                   focus:ring-2 focus:ring-blue-500 focus:border-transparent ${className}`}
      />
      
      <AnimatePresence>
        {showSuggestions && filteredSuggestions.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 
                     rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 
                     max-h-48 overflow-y-auto z-50"
          >
            {filteredSuggestions.slice(0, 5).map((suggestion, index) => (
              <button
                key={index}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700
                         text-sm text-gray-700 dark:text-gray-300 first:rounded-t-lg"
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSuggestionClick(suggestion)
                }}
              >
                {suggestion.label ?? suggestion.value}
              </button>
            ))}
            {filteredSuggestions.length > 5 && (
              <>
                <div className="border-t border-gray-200 dark:border-gray-700" />
                <div className="max-h-32 overflow-y-auto">
                  {filteredSuggestions.slice(5).map((suggestion, index) => (
                    <button
                      key={index + 5}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 
                               text-sm text-gray-700 dark:text-gray-300 last:rounded-b-lg"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        handleSuggestionClick(suggestion)
                      }}
                    >
                      {suggestion.label ?? suggestion.value}
                    </button>
                  ))}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}