import Redis from 'ioredis'
import { getSecret } from './aws-secrets'

// ---------------------------------------------------------------------------
// Local Redis (TCP) client with in-memory Map fallback.
// FINAPI and the dashboard share the local Proxmox Redis (192.168.0.160);
// Upstash is reserved for partly/lambdas. Set REDIS_URL=redis://:<pw>@host:6379.
// (Was @upstash/redis — a REST client that can't talk to a normal Redis.)
// ---------------------------------------------------------------------------

let redis: Redis | null = null
let redisInitialized = false

// Fallback in-memory cache (used when REDIS_URL is not set / DISABLE_REDIS).
const memoryCache = new Map<string, { data: unknown; expires: number }>()

/** Lazily initialize Redis (secrets may not be available at module load time). */
function getRedis(): Redis | null {
  if (redisInitialized) return redis

  // Opt out (e.g. local dev) — fall back to the in-memory cache so data is
  // fetched live from FINAPI rather than a shared Redis.
  if (process.env.DISABLE_REDIS === 'true') {
    redisInitialized = true
    console.warn('[redis-client] DISABLE_REDIS=true — in-memory cache, live FINAPI reads')
    return null
  }

  const url = process.env.REDIS_URL || getSecret('REDIS_URL')

  if (url) {
    redis = new Redis(url, {
      // Fail fast to the in-memory fallback instead of hanging if Redis is down.
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 5000,
    })
    redis.on('error', (e: Error) =>
      console.warn('[redis-client] Redis error:', e.message?.substring(0, 200)),
    )
    console.log('[redis-client] Using local Redis (TCP)')
  } else {
    console.warn('[redis-client] REDIS_URL not set — using in-memory Map fallback')
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
    try {
      const value = await r.get(key)
      if (value == null) return null
      try {
        return JSON.parse(value) as T
      } catch {
        return value as unknown as T // non-JSON value
      }
    } catch (e: any) {
      console.warn(`[redis-client] getCached failed for "${key}":`, e.message?.substring(0, 200))
      return null
    }
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
      await r.set(key, JSON.stringify(value), 'EX', ttlSeconds)
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
    try {
      await r.del(key)
    } catch (e: any) {
      console.warn(`[redis-client] deleteCache failed for key "${key}":`, e.message?.substring(0, 200))
    }
    return
  }

  // In-memory fallback
  memoryCache.delete(key)
}
