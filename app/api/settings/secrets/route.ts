import { NextResponse } from 'next/server'
import { forgetSecret } from '@/lib/aws-secrets'
import { checkEditPassword, editingEnabled, sessionEmail } from '@/lib/settings-gate'

/**
 * /api/settings/secrets — the app's Secrets Manager config, from the dashboard.
 *
 * GET  returns every key and value of the config secret. Reading needs only a
 *      signed-in dashboard session (the page itself sits behind /login; API
 *      routes are outside that middleware, so the session is checked here).
 * PUT  changes keys. It needs the session AND the settings password, checked
 *      in constant time and rate-limited per address. The password is the
 *      SETTINGS_EDIT_PASSWORD environment variable (set on the Dokploy app);
 *      with it unset, editing is off and the page says so. It is not in the
 *      source on purpose: the repository is on GitHub.
 *
 * Writes go through PutSecretValue, which versions the secret: Secrets Manager
 * keeps the previous version under AWSPREVIOUS, so a bad edit is one
 * `update-secret-version-stage` away from undone. After a write the in-process
 * caches forget the touched keys, so the running app reads the new value on
 * its next use rather than after the next restart.
 */

const SECRET_ID = process.env.APP_SECRETS_ID || process.env.AWS_SECRETS_ID || 'config'
const REGION = process.env.AWS_REGION || 'eu-central-1'

const sessionOk = async () => (await sessionEmail()) !== null

async function client() {
  const { SecretsManagerClient } = await import('@aws-sdk/client-secrets-manager')
  return new SecretsManagerClient({ region: REGION })
}

async function readSecret(): Promise<{ values: Record<string, string>; versionId?: string; createdDate?: string }> {
  const { GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager')
  const res = await (await client()).send(new GetSecretValueCommand({ SecretId: SECRET_ID }))
  const values = res.SecretString ? (JSON.parse(res.SecretString) as Record<string, string>) : {}
  return { values, versionId: res.VersionId, createdDate: res.CreatedDate?.toISOString() }
}

export async function GET() {
  if (!(await sessionOk())) return NextResponse.json({ error: 'sign in first' }, { status: 401 })
  try {
    const { values, versionId, createdDate } = await readSecret()
    const keys = Object.keys(values).sort().map((key) => ({ key, value: String(values[key] ?? '') }))
    return NextResponse.json({ secretId: SECRET_ID, region: REGION, versionId, createdDate, keys, editable: editingEnabled() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'could not read the secret' }, { status: 502 })
  }
}

export async function PUT(req: Request) {
  if (!(await sessionOk())) return NextResponse.json({ error: 'sign in first' }, { status: 401 })

  let body: { password?: string; updates?: Record<string, string>; deletes?: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad body' }, { status: 400 }) }

  const gate = checkEditPassword(req, body.password)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const updates = body.updates ?? {}
  const deletes = body.deletes ?? []
  const keyOk = (k: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)
  for (const k of [...Object.keys(updates), ...deletes]) {
    if (!keyOk(k)) return NextResponse.json({ error: `bad key: ${k}` }, { status: 400 })
  }
  if (Object.keys(updates).length === 0 && deletes.length === 0) {
    return NextResponse.json({ error: 'nothing to change' }, { status: 400 })
  }

  try {
    const { values } = await readSecret()
    const next: Record<string, string> = { ...values }
    for (const [k, v] of Object.entries(updates)) next[k] = String(v ?? '')
    for (const k of deletes) delete next[k]
    const { PutSecretValueCommand } = await import('@aws-sdk/client-secrets-manager')
    const res = await (await client()).send(new PutSecretValueCommand({ SecretId: SECRET_ID, SecretString: JSON.stringify(next, null, 2) }))
    for (const k of [...Object.keys(updates), ...deletes]) forgetSecret(k)
    return NextResponse.json({ ok: true, versionId: res.VersionId, changed: Object.keys(updates), deleted: deletes })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'could not write the secret' }, { status: 502 })
  }
}
