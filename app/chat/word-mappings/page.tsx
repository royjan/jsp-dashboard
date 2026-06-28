'use client'

import { Languages } from 'lucide-react'
import WordMappingDashboard from '@/components/chat-admin/word-mappings/WordMappingDashboard'
import { AdminPageHeader } from '@/components/chat-admin/shared'

export default function WordMappingsPage() {
  return (
    <div dir="ltr" className="chat-admin">
      <AdminPageHeader
        title="Word Mappings"
        subtitle="Manage multilingual search-term mappings (Hebrew ↔ English synonyms & translations)"
        icon={<Languages className="w-6 h-6" />}
      />
      <WordMappingDashboard />
    </div>
  )
}
