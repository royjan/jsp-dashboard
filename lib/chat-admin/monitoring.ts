/**
 * Lambda-status monitoring for the integrated chat admin.
 * Drizzle ORM over the shared `lambda_status` table. No caching (admin, low traffic).
 */

import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { lambdaStatus } from '@/lib/db/schema'

export type ServiceName = 'psa' | 'partslink' | 'vin17' | 'qipei' | 'saic'

/** Services we always surface in monitoring, even if they have no DB row yet. */
export const KNOWN_SERVICES: ServiceName[] = ['psa', 'partslink', 'vin17', 'qipei', 'saic']

export interface LambdaStatusSummary {
  serviceName: string
  status: string
  errorType: string | null
  errorMessage: string | null
  lastSuccess: Date | string | null
  lastFailure: Date | string | null
  consecutiveFailures: number
  isEnabled: boolean
  updatedAt: Date | string | null
}

type Row = typeof lambdaStatus.$inferSelect

function rowToSummary(s: Row): LambdaStatusSummary {
  return {
    serviceName: s.serviceName,
    status: s.status,
    errorType: s.errorType,
    errorMessage: s.errorMessage,
    lastSuccess: s.lastSuccess,
    lastFailure: s.lastFailure,
    consecutiveFailures: s.consecutiveFailures ?? 0,
    isEnabled: s.isEnabled,
    updatedAt: s.updatedAt,
  }
}

function syntheticUnknown(serviceName: string): LambdaStatusSummary {
  return {
    serviceName,
    status: 'unknown',
    errorType: null,
    errorMessage: null,
    lastSuccess: null,
    lastFailure: null,
    consecutiveFailures: 0,
    isEnabled: true,
    updatedAt: null,
  }
}

export async function getAllLambdaStatuses(): Promise<LambdaStatusSummary[]> {
  const db = await getDb()
  const rows = await db.select().from(lambdaStatus).orderBy(lambdaStatus.serviceName)
  const byName = new Map<string, LambdaStatusSummary>(rows.map((r) => [r.serviceName, rowToSummary(r)]))
  // Always include every known service (e.g. saic may be live in search_analytics
  // before the chat runtime has written its lambda_status row).
  for (const svc of KNOWN_SERVICES) if (!byName.has(svc)) byName.set(svc, syntheticUnknown(svc))
  return Array.from(byName.values()).sort((a, b) => a.serviceName.localeCompare(b.serviceName))
}

export async function hasServiceIssues(): Promise<{
  hasIssues: boolean
  services: LambdaStatusSummary[]
}> {
  const statuses = await getAllLambdaStatuses()
  const problems = statuses.filter((s) => s.status !== 'healthy' && s.status !== 'unknown')
  return { hasIssues: problems.length > 0, services: problems }
}

export async function resetLambdaStatus(serviceName: ServiceName): Promise<LambdaStatusSummary> {
  const db = await getDb()
  // Upsert so a known service without a row yet (e.g. saic) can still be reset.
  const [row] = await db
    .insert(lambdaStatus)
    .values({
      serviceName,
      status: 'unknown',
      errorType: null,
      errorMessage: null,
      consecutiveFailures: 0,
      lastCheck: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: lambdaStatus.serviceName,
      set: {
        status: 'unknown',
        errorType: null,
        errorMessage: null,
        consecutiveFailures: 0,
        lastCheck: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning()
  return rowToSummary(row)
}

export async function setLambdaEnabled(serviceName: ServiceName, enabled: boolean): Promise<void> {
  const db = await getDb()
  await db
    .insert(lambdaStatus)
    .values({ serviceName, isEnabled: enabled, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: lambdaStatus.serviceName,
      set: { isEnabled: enabled, updatedAt: sql`NOW()` },
    })
}
