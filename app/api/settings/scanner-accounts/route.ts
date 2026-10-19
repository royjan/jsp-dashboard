import { NextResponse } from 'next/server'
import { forgetSecret } from '@/lib/aws-secrets'
import { checkEditPassword, editingEnabled, sessionEmail } from '@/lib/settings-gate'
import {
  applyChange,
  buildView,
  ChangeError,
  providerById,
  revealPassword,
  type Change,
  type LambdaRef,
} from '@/lib/scanner-accounts'

/**
 * /api/settings/scanner-accounts — the portal logins each scraper Lambda uses.
 *
 * GET   signed-in session. Usernames, which accounts are on, and when each
 *       scanner last picked up the config. NEVER a password.
 * POST  signed-in session AND the settings password (lib/settings-gate.ts).
 *       { password, provider, change }   change one account (see Change)
 *       { password, provider, reveal }   one account's password, on request
 *       { password, provider, apply }    recycle the provider's Lambdas now
 *       A change may carry `apply: true` to do both in one step.
 *
 * Writes go through PutSecretValue on the `config` secret, which versions it
 * (the previous version stays under AWSPREVIOUS). Scanners read that secret
 * once per container, so a change reaches them only when their containers are
 * recycled: "apply" touches each Lambda's configuration (an env var stamp),
 * which makes every NEW invocation start fresh. Running scans finish on the
 * old login — nothing is killed.
 */

const SECRET_ID = process.env.APP_SECRETS_ID || process.env.AWS_SECRETS_ID || 'config'
const REGION = process.env.AWS_REGION || 'eu-central-1'
const REFRESH_ENV = 'SECRETS_REFRESHED_AT'

async function sm() {
  const mod = await import('@aws-sdk/client-secrets-manager')
  return { mod, client: new mod.SecretsManagerClient({ region: REGION }) }
}

async function readSecret(): Promise<Record<string, string>> {
  const { mod, client } = await sm()
  const res = await client.send(new mod.GetSecretValueCommand({ SecretId: SECRET_ID }))
  return res.SecretString ? (JSON.parse(res.SecretString) as Record<string, string>) : {}
}

async function writeSecret(values: Record<string, string>): Promise<string | undefined> {
  const { mod, client } = await sm()
  const res = await client.send(new mod.PutSecretValueCommand({ SecretId: SECRET_ID, SecretString: JSON.stringify(values, null, 2) }))
  return res.VersionId
}

interface LambdaState extends LambdaRef {
  /** When this scanner last picked up the config (our stamp, else its last update). */
  refreshedAt: string | null
  error?: string
}

async function lambdaState(ref: LambdaRef): Promise<LambdaState> {
  try {
    const { LambdaClient, GetFunctionConfigurationCommand } = await import('@aws-sdk/client-lambda')
    const cfg = await new LambdaClient({ region: ref.region }).send(new GetFunctionConfigurationCommand({ FunctionName: ref.name }))
    const stamp = cfg.Environment?.Variables?.[REFRESH_ENV]
    const modified = cfg.LastModified ? new Date(cfg.LastModified).toISOString() : null
    // Any configuration or code update recycles containers, so the later of the two counts.
    const refreshedAt = [stamp, modified].filter(Boolean).sort().pop() ?? null
    return { ...ref, refreshedAt }
  } catch (e) {
    return { ...ref, refreshedAt: null, error: e instanceof Error ? e.name : 'unavailable' }
  }
}

async function refreshLambda(ref: LambdaRef, now: string): Promise<{ name: string; ok: boolean; error?: string }> {
  try {
    const { LambdaClient, GetFunctionConfigurationCommand, UpdateFunctionConfigurationCommand } = await import('@aws-sdk/client-lambda')
    const client = new LambdaClient({ region: ref.region })
    const cfg = await client.send(new GetFunctionConfigurationCommand({ FunctionName: ref.name }))
    // UpdateFunctionConfiguration REPLACES the environment — carry every existing variable.
    const variables = { ...(cfg.Environment?.Variables ?? {}), [REFRESH_ENV]: now }
    await client.send(new UpdateFunctionConfigurationCommand({ FunctionName: ref.name, Environment: { Variables: variables } }))
    return { name: ref.name, ok: true }
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    const error = name === 'ResourceConflictException'
      ? 'an update is already in progress — try again in a minute'
      : e instanceof Error ? e.message : 'refresh failed'
    return { name: ref.name, ok: false, error }
  }
}

export async function GET() {
  const email = await sessionEmail()
  if (email === null) return NextResponse.json({ error: 'sign in first' }, { status: 401 })
  try {
    const values = await readSecret()
    const providers = buildView(values)
    const states = await Promise.all(providers.flatMap((p) => p.lambdas.map(lambdaState)))
    const byName = new Map(states.map((s) => [s.name, s]))
    return NextResponse.json({
      editable: editingEnabled(),
      providers: providers.map((p) => ({ ...p, lambdas: p.lambdas.map((l) => byName.get(l.name) ?? { ...l, refreshedAt: null }) })),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'could not read the config' }, { status: 502 })
  }
}

interface PostBody {
  password?: string
  provider?: string
  change?: Change
  reveal?: string
  apply?: boolean
}

export async function POST(req: Request) {
  const email = await sessionEmail()
  if (email === null) return NextResponse.json({ error: 'sign in first' }, { status: 401 })

  let body: PostBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad body' }, { status: 400 }) }

  const gate = checkEditPassword(req, body.password)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  const provider = providerById(String(body.provider ?? ''))
  if (!provider) return NextResponse.json({ error: 'unknown provider' }, { status: 400 })

  try {
    if (body.reveal) {
      const values = await readSecret()
      return NextResponse.json({ password: revealPassword(values, provider.id, body.reveal) })
    }

    let versionId: string | undefined
    if (body.change) {
      const values = await readSecret()
      const next = applyChange(values, provider.id, body.change, email || 'dashboard', new Date())
      versionId = await writeSecret(next.values)
      for (const k of next.touched) forgetSecret(k)
    } else if (!body.apply) {
      return NextResponse.json({ error: 'nothing to do' }, { status: 400 })
    }

    let applied: Awaited<ReturnType<typeof refreshLambda>>[] = []
    if (body.apply) {
      const now = new Date().toISOString()
      applied = await Promise.all(provider.lambdas.map((l) => refreshLambda(l, now)))
    }
    return NextResponse.json({ ok: true, versionId, applied })
  } catch (e) {
    if (e instanceof ChangeError) return NextResponse.json({ error: e.message }, { status: 400 })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'could not save' }, { status: 502 })
  }
}
