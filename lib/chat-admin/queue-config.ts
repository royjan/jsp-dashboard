/**
 * Queue Configuration
 *
 * Reads configuration from /config/queue-config.json for easy editing.
 * Defines concurrency limits and timing estimates for Lambda search queues.
 */

import queueConfigJson from './queue-config.json'

export type LambdaType = 'psa' | 'partslink' | 'vin17' | 'qipei'

export interface QueueConfigType {
  lambdaConcurrency: Record<LambdaType, number>
  estimatedDurationMs: Record<LambdaType, number>
  redis: {
    keyPrefix: string
    activePrefix: string
    queuePrefix: string
    searchPrefix: string
    userPrefix: string
    statsKey: string
    searchTTLSeconds: number
    statsTTLSeconds: number
    completedTTLSeconds: number
  }
  staleSearchTimeoutMs: number
  cleanupIntervalMs: number
  maxQueueSize: number
}

export const QUEUE_CONFIG: QueueConfigType = queueConfigJson as QueueConfigType

/**
 * Calculate estimated wait time based on queue position and Lambda type
 */
export function calculateEstimatedWait(
  lambdaType: LambdaType,
  queuePosition: number
): number {
  const estimatedDuration = QUEUE_CONFIG.estimatedDurationMs[lambdaType]
  return queuePosition * estimatedDuration
}

/**
 * Get max concurrent searches for a Lambda type
 */
export function getMaxConcurrent(lambdaType: LambdaType): number {
  return QUEUE_CONFIG.lambdaConcurrency[lambdaType] || 1
}

/**
 * Format wait time for display
 */
export function formatWaitTime(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) {
    return `~${seconds}s`
  }
  const minutes = Math.round(seconds / 60)
  return `~${minutes} min`
}
