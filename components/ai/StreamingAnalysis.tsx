'use client'

import ReactMarkdown from 'react-markdown'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useLocale } from '@/lib/locale-context'
import { Sparkles, Loader2 } from 'lucide-react'

interface StreamingAnalysisProps {
  title: string
  completion: string
  isLoading: boolean
  onStart: () => void
}

export function StreamingAnalysis({ title, completion, isLoading, onStart }: StreamingAnalysisProps) {
  const { t, dir } = useLocale()

  return (
    <Card className="flex flex-col h-full" dir={dir}>
      <CardHeader className="flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={onStart}
          disabled={isLoading}
          className="h-7 text-xs"
        >
          {isLoading ? (
            <><Loader2 className="h-3 w-3 animate-spin me-1" /> {t('analyzing')}</>
          ) : (
            t('analyze')
          )}
        </Button>
      </CardHeader>
      <CardContent className="flex-1 min-h-0">
        <ScrollArea className="h-full max-h-[500px]">
          {completion ? (
            <div dir={dir} className="prose prose-sm dark:prose-invert max-w-none text-sm [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:bg-muted [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_h3]:text-base [&_h4]:text-sm [&_ul]:my-1 [&_li]:my-0.5">
              <ReactMarkdown>{completion}</ReactMarkdown>
              {isLoading && <span className="animate-pulse text-primary">|</span>}
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              {t('clickAnalyze')}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
