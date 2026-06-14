import { Redis } from '@upstash/redis'
import { getSecret } from './aws-secrets'

// ---------------------------------------------------------------------------
// Upstash Redis client with in-memory Map fallback for local dev
// ---------------------------------------------------------------------------

let redis: Redis | null = null
let redisInitialized = false

// Fallback in-memory cache (used when Upstash env vars are not set)
const memoryCache = new Map<string, { data: unknown; expires: number }>()

/** Lazily initialize Upstash Redis (secrets may not be available at module load time). */
function getRedis(): Redis | null {
  if (redisInitialized) return redis

  const url = process.env.UPSTASH_REDIS_REST_URL || getSecret('UPSTASH_REDIS_REST_URL')
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || getSecret('UPSTASH_REDIS_REST_TOKEN')

  if (url && token) {
    redis = new Redis({ url, token })
    console.log('[redis-client] Connected to Upstash Redis')
  } else {
    console.warn('[redis-client] Upstash credentials not available — using in-memory Map fallback')
  }

  redisInitialized = true
  return redis
}

// ---------------------------------------------------------------------------
// Public API — same interface regardless of backend
// ---------------------------------------------------------------------------

export async function getCached<T>(key: string): Promise<T | null> {
  const r = getRedis()
  if (r) {
    const value = await r.get<T>(key)
    return value ?? null
  }

  // In-memory fallback
  const entry = memoryCache.get(key)
  if (!entry || Date.now() > entry.expires) {
    memoryCache.delete(key)
    return null
  }
  return entry.data as T
}

export async function setCache(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const r = getRedis()
  if (r) {
    try {
      await r.set(key, value, { ex: ttlSeconds })
    } catch (e: any) {
      console.warn(`[redis-client] setCache failed for key "${key}":`, e.message?.substring(0, 200))
    }
    return
  }

  // In-memory fallback
  memoryCache.set(key, { data: value, expires: Date.now() + ttlSeconds * 1000 })
}

export async function deleteCache(key: string): Promise<void> {
  const r = getRedis()
  if (r) {
    await r.del(key)
    return
  }

  // In-memory fallback
  memoryCache.delete(key)
}
