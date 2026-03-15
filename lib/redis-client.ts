import { Redis } from '@upstash/redis'
import { getSecret, initializeSecrets } from './aws-secrets'

let redis: Redis | null = null
let initialized = false
let initPromise: Promise<Redis | null> | null = null

export async function getSharedRedis(): Promise<Redis | null> {
  if (initialized) return redis
  if (initPromise) return initPromise
  initPromise = initializeRedis()
  return initPromise
}

async function initializeRedis(): Promise<Redis | null> {
  try {
    await initializeSecrets()
    const url = getSecret('UPSTASH_REDIS_REST_URL')
    const token = getSecret('UPSTASH_REDIS_REST_TOKEN')

    if (!url || !token) {
      console.warn('[Redis] Missing credentials')
      initialized = true
      return null
    }

    redis = new Redis({ url, token })
    const pong = await redis.ping()
    if (pong === 'PONG') {
      console.log('[Redis] Connected to Upstash Redis')
    }
    initialized = true
    return redis
  } catch (error) {
    console.warn('[Redis] Failed to connect:', error)
    redis = null
    initialized = true
    return null
  }
}

export async function getCached<T>(key: string): Promise<T | null> {
  const client = await getSharedRedis()
  if (!client) return null
  try {
    return await client.get<T>(key)
  } catch {
    return null
  }
}

export async function setCache(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const client = await getSharedRedis()
  if (!client) return
  try {
    await client.set(key, value, { ex: ttlSeconds })
  } catch {
    // Cache is non-blocking
  }
}
