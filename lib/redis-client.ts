const cache = new Map<string, { data: any; expires: number }>()

export async function getCached<T>(key: string): Promise<T | null> {
  const entry = cache.get(key)
  if (!entry || Date.now() > entry.expires) {
    cache.delete(key)
    return null
  }
  return entry.data as T
}

export async function setCache(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  cache.set(key, { data: value, expires: Date.now() + ttlSeconds * 1000 })
}

export async function deleteCache(key: string): Promise<void> {
  cache.delete(key)
}
