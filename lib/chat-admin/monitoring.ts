/**
 * Lambda-status monitoring for the integrated chat admin.
 * Ported from jsp-chat-js's lambda-status-service onto raw `query()`.
 * Reads/writes the shared `lambda_status` table. No caching (admin, low traffic).
 */

import { query } from '@/lib/db'

export type ServiceName = 'psa' | 'partslink' | 'vin17' | 'qipei'

export interface LambdaStatusSummary {
  serviceName: string
  status: string
  errorType: string | null
  errorMessage: string | null
  lastSuccess: Date | string | null
  lastFailure: Date | string | null
  consecutiveFailures: number
  isEnabled: boolean
  updatedAt: Date | string
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

export async function getAllLambdaStatuses(): Promise<LambdaStatusSummary[]> {
  const res = await query('SELECT * FROM lambda_status ORDER BY service_name ASC')
  return res.rows.map(rowToSummary)
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
  const res = await query(
    `UPDATE lambda_status
     SET status = 'unknown', error_type = NULL, error_message = NULL,
         consecutive_failures = 0, last_check = NOW(), updated_at = NOW()
     WHERE service_name = $1
     RETURNING *`,
    [serviceName],
  )
  if (!res.rows[0]) throw new Error(`Lambda service not found: ${serviceName}`)
  return rowToSummary(res.rows[0])
}

export async function setLambdaEnabled(serviceName: ServiceName, enabled: boolean): Promise<void> {
  const res = await query(
    `UPDATE lambda_status SET is_enabled = $2, updated_at = NOW() WHERE service_name = $1`,
    [serviceName, enabled],
  )
  if (res.rowCount === 0) throw new Error(`Lambda service not found: ${serviceName}`)
}
