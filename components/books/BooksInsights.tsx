'use client'

/**
 * ניתוח AI — the model's reading of the period, rendered.
 *
 * Three things this handles that the first version did not:
 *
 *  - The model writes light markdown (### headings, **bold**, bullet lists,
 *    `---` rules). Dumping it into paragraphs showed the asterisks and hashes
 *    on screen, so it is parsed here.
 *  - Amounts obey the money toggle. `maskMoneyInText` hides every figure in the
 *    prose the same way the tiles hide theirs — one generation, two readings,
 *    rather than asking the model for a second version.
 *  - The answer is kept for a week server-side, so opening the page does not
 *    re-run it; "נתח שוב" is what regenerates.
 */

import { useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { formatDate, maskMoneyInText } from '@/lib/format'
import { useMoneyHidden } from '@/lib/use-money-hidden'
import { useBooksInsights } from '@/hooks/use-books'
import { useBooksText } from './BooksChrome'

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'rule' }

/** Light markdown → blocks. Deliberately small: this renders one model's
 *  output, not arbitrary documents. */
function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let list: string[] | null = null

  const flush = () => {
    if (list?.length) blocks.push({ kind: 'list', items: list })
    list = null
  }

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) { flush(); continue }
    if (/^[-—_*]{3,}$/.test(line)) { flush(); blocks.push({ kind: 'rule' }); continue }
    if (/^#{1,6}\s/.test(line)) {
      flush()
      blocks.push({ kind: 'heading', text: line.replace(/^#{1,6}\s*/, '') })
      continue
    }
    // A numbered heading with no marker ("1. שורה תחתונה") is a heading too —
    // the prompt asks for three of them and the model numbers them.
    if (/^\d+\.\s*\S/.test(line) && line.length < 40 && !/\d[\d,.]*\s*(₪|ש)/.test(line)) {
      flush()
      blocks.push({ kind: 'heading', text: line.replace(/^\d+\.\s*/, '') })
      continue
    }
    if (/^([-•*]\s+|\d+[.)]\s+)/.test(line)) {
      list ??= []
      list.push(line.replace(/^([-•*]\s+|\d+[.)]\s+)/, ''))
      continue
    }
    flush()
    blocks.push({ kind: 'para', text: line })
  }
  flush()
  return blocks
}

/** `**bold**` → <b>, everything else escaped by React. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**')
          ? <b key={i} className="font-semibold">{part.slice(2, -2)}</b>
          : <span key={i}>{part}</span>)}
    </>
  )
}

export function BooksInsights({ params }: {
  params: Record<string, string | number | undefined>
}) {
  const hidden = useMoneyHidden()
  const { t } = useBooksText()
  const [asked, setAsked] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const { data, isFetching, error } = useBooksInsights(
    { ...params, ...(refresh ? { refresh: '1' } : {}) } as any, asked)

  // Re-masks whenever the eye is toggled — `hidden` is in the dep list for
  // exactly that reason, even though the mask reads the store itself.
  const blocks = useMemo(
    () => (data?.text ? parseBlocks(maskMoneyInText(data.text)) : []),
    [data?.text, hidden],
  )

  const run = () => {
    if (asked) setRefresh((n) => n + 1)
    setAsked(true)
  }

  return (
    <section className="rounded-xl border border-primary/30 bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Sparkles className="h-4 w-4 text-primary" />
        <b className="text-sm">{t('aiTitle')}</b>
        <span className="text-xs text-muted-foreground">{t('aiHint')}</span>
        <button
          type="button"
          disabled={isFetching}
          onClick={run}
          className="ms-auto rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60 pointer-coarse:min-h-11"
        >
          {isFetching ? t('aiRunning') : asked ? t('aiAgain') : t('aiRun')}
        </button>
      </div>

      {error && (
        <p className="mt-3 border-t pt-3 text-sm text-destructive">{(error as Error).message}</p>
      )}

      {blocks.length > 0 && (
        <div className="mt-3 space-y-2.5 border-t pt-3 text-sm leading-7">
          {blocks.map((block, i) => {
            if (block.kind === 'rule') return <hr key={i} className="my-3 border-border" />
            if (block.kind === 'heading') {
              return (
                <h3 key={i} className="mt-4 text-sm font-semibold text-foreground first:mt-0">
                  {block.text}
                </h3>
              )
            }
            if (block.kind === 'list') {
              return (
                <ul key={i} className="space-y-1.5 ps-1">
                  {block.items.map((item, j) => (
                    <li key={j} className="flex gap-2">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary" />
                      <span><Inline text={item} /></span>
                    </li>
                  ))}
                </ul>
              )
            }
            return <p key={i}><Inline text={block.text} /></p>
          })}

          {data?.generated_at && (
            <p className="pt-1 text-xs text-muted-foreground">
              {formatDate(data.generated_at, 'datetime')}
              {data.cached && ` · ${t('aiSaved')}`}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
