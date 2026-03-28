import { useSyncExternalStore } from 'react'

let count = 0
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(l => l())

export const incrementStreaming = () => { count++; notify() }
export const decrementStreaming = () => { count = Math.max(0, count - 1); notify() }

const getCount = () => count
const getServerCount = () => 0

export function useStreamingCount() {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb) },
    getCount,
    getServerCount,
  )
}
