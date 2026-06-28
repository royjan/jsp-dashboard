/**
 * Lambda-status monitoring for the integrated chat admin.
 * Ported from jsp-chat-js's lambda-status-service onto raw `query()`.
 * Reads/writes the shared `lambda_status` table. No caching (admin, low traffic).
 */

import { query } from '@/lib/db'

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

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToSummary(s: any): LambdaStatusSummary {
  return {
    serviceName: s.service_name,
    status: s.status,
    errorType: s.error_type,
    errorMessage: s.error_message,
    lastSuccess: s.last_success,
    lastFailure: s.last_failure,
    consecutiveFailures: s.consecutive_failures ?? 0,
    isEnabled: s.is_enabled,
    updatedAt: s.updated_at,
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
  const res = await query('SELECT * FROM lambda_status ORDER BY service_name ASC')
  const byName = new Map<string, LambdaStatusSummary>(res.rows.map((r: any) => [r.service_name, rowToSummary(r)]))
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
  // Upsert so a known service without a row yet (e.g. saic) can still be reset.
  const res = await query(
    `INSERT INTO lambda_status (service_name, status, error_type, error_message, consecutive_failures, last_check, updated_at)
     VALUES ($1, 'unknown', NULL, NULL, 0, NOW(), NOW())
     ON CONFLICT (service_name) DO UPDATE
       SET status = 'unknown', error_type = NULL, error_message = NULL,
           consecutive_failures = 0, last_check = NOW(), updated_at = NOW()
     RETURNING *`,
    [serviceName],
  )
  return rowToSummary(res.rows[0])
}

export async function setLambdaEnabled(serviceName: ServiceName, enabled: boolean): Promise<void> {
  await query(
    `INSERT INTO lambda_status (service_name, is_enabled, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (service_name) DO UPDATE SET is_enabled = $2, updated_at = NOW()`,
    [serviceName, enabled],
  )
}
