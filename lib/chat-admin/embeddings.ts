/**
 * OpenAI embedding helper for the integrated chat admin.
 *
 * Embeddings MUST use OpenAI text-embedding-3-small (1536-dim) to match the
 * vectors already stored in part_descriptions.embedding / the
 * flow_decisions_with_embeddings view. Gemini (768-dim) is incompatible.
 *
 * Returns null when OPENAI_API_KEY is absent or the call fails, so callers can
 * degrade gracefully (flow-decision create still works with a null embedding;
 * the simulator surfaces a clear "unavailable" result).
 */

import { getSecret } from '@/lib/aws-secrets'

const MODEL = 'text-embedding-3-small'

export async function embedText(text: string): Promise<number[] | null> {
  const apiKey = getSecret('OPENAI_API_KEY')
  if (!apiKey) return null
  const input = text.toLowerCase().trim().split('\n')[0]
  if (!input) return null
  // Hard timeout so a slow/hanging OpenAI call can't pin a pooled DB connection
  // (callers hold a pg connection across this await) and starve the rest of the app.
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: MODEL, input }),
      signal: controller.signal,
    })
    if (!res.ok) {
      console.error('[embeddings] OpenAI error:', res.status, await res.text())
      return null
    }
    const json = await res.json()
    const embedding = json?.data?.[0]?.embedding
    return Array.isArray(embedding) ? embedding : null
  } catch (err) {
    console.error('[embeddings] request failed:', err)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/** Format a JS number[] as a pgvector literal: `[0.1,0.2,...]`. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`
}
