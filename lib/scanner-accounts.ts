/**
 * Scanner portal accounts — which login each scraper Lambda uses, and in what
 * order it falls back. Pure: the API route reads/writes the `config` secret and
 * hands the values here, so everything below is testable without AWS.
 *
 * Every scanner reads its login from the `config` secret ONCE per container
 * (jsp-selenium-lambdas common/base/config.py `_cached_secrets`), so a change
 * only reaches a scanner after its containers are recycled — the route does
 * that by touching the Lambda's configuration ("apply now").
 *
 * Only PSA walks an account ladder today (psa/app/services/session_manager.py
 * `_swap_to_fallback_credentials`): primary dealer → fallback dealer → public
 * portal. A rung is used only when BOTH its keys are non-empty, and there is no
 * on/off flag — so switching a rung off here PARKS its keys under `<KEY>__OFF`
 * (the scanner sees nothing and skips it) and switching it on moves them back.
 * Nothing is ever deleted.
 */

export type RungKind = 'dealer' | 'public' | 'account'

export interface RungDef {
  id: string
  userKey: string
  passKey: string
  kind: RungKind
  labelHe: string
  labelEn: string
  /** May be switched off. The primary account of a provider cannot. */
  toggleable: boolean
}

export interface LambdaRef {
  name: string
  region: string
}

export interface ProviderDef {
  id: string
  nameHe: string
  nameEn: string
  rungs: RungDef[]
  lambdas: LambdaRef[]
  /** Does the scanner walk to a second account when the first login fails? */
  fallbackSupported: boolean
  /** Editing the secret has no effect (credentials are baked in at deploy). */
  readOnlyReasonHe?: string
  readOnlyReasonEn?: string
  noteHe?: string
  noteEn?: string
}

export const PARKED_SUFFIX = '__OFF'
export const META_KEY = 'SCANNER_ACCOUNTS_META'

const primary = (prefix: string, userKey = `${prefix}_USERNAME`, passKey = `${prefix}_PASSWORD`): RungDef => ({
  id: 'primary', userKey, passKey, kind: 'account', labelHe: 'חשבון ראשי', labelEn: 'Primary account', toggleable: false,
})

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'psa',
    nameHe: 'PSA · ServiceBox',
    nameEn: 'PSA · ServiceBox',
    rungs: [
      { id: 'primary', userKey: 'PSA_USERNAME', passKey: 'PSA_PASSWORD', kind: 'dealer', labelHe: 'סוכן ראשי', labelEn: 'Dealer — primary', toggleable: false },
      { id: 'fallback', userKey: 'PSA_USERNAME_FALLBACK', passKey: 'PSA_PASSWORD_FALLBACK', kind: 'dealer', labelHe: 'סוכן גיבוי', labelEn: 'Dealer — fallback', toggleable: true },
      { id: 'public', userKey: 'PSA_USERNAME_PUBLIC', passKey: 'PSA_PASSWORD_PUBLIC', kind: 'public', labelHe: 'פורטל ציבורי', labelEn: 'Public portal', toggleable: true },
    ],
    lambdas: [
      { name: 'psa-vehicle-service-lambda-dev-api', region: 'eu-west-3' },
      { name: 'psa-catalog-service-lambda-dev-api', region: 'eu-west-3' },
    ],
    fallbackSupported: true,
    noteHe: 'הפורטל הציבורי מתחבר ומחפש חלקים, אבל לא יכול להריץ סריקה מלאה. סורק שירד לגיבוי נשאר עליו עד שמרעננים אותו. portal-pilot (דייגו) שומר עותק משלו של הסיסמה ב-Redis — לעדכן גם שם.',
    noteEn: 'The public portal can sign in and look up parts but cannot run a full scan. A scanner that dropped to a fallback stays on it until refreshed. portal-pilot (Diego) keeps its own copy of the password in Redis — update it there too.',
  },
  {
    id: 'partslink',
    nameHe: 'PartsLink24 · טויוטה',
    nameEn: 'PartsLink24 · Toyota',
    rungs: [primary('PARTSLINK')],
    lambdas: [
      { name: 'partslink-vehicle-service-lambda-dev-api', region: 'eu-central-1' },
      { name: 'partslink-vehicle-service-lambda-hk-api', region: 'eu-central-1' },
    ],
    fallbackSupported: false,
    noteHe: 'החשבון מאפשר חיבור אחד בכל פעם.',
    noteEn: 'The account allows one session at a time.',
  },
  {
    id: 'saic',
    nameHe: 'SAIC · MG',
    nameEn: 'SAIC · MG',
    rungs: [primary('SAIC')],
    lambdas: [
      { name: 'saic-vehicle-service-lambda-prod-api', region: 'ap-northeast-2' },
      { name: 'saic-vehicle-service-lambda-prod-orchestrator', region: 'ap-northeast-2' },
    ],
    fallbackSupported: false,
  },
  {
    id: 'qipei',
    nameHe: 'Qipei · cii.me',
    nameEn: 'Qipei · cii.me',
    rungs: [primary('QIPEI', 'QIPEI_CII_ME_USERNAME', 'QIPEI_CII_ME_PASSWORD')],
    lambdas: [{ name: 'qipei-vehicle-service-lambda-dev-api', region: 'eu-central-1' }],
    fallbackSupported: false,
  },
  {
    id: 'vin17',
    nameHe: 'VIN17',
    nameEn: 'VIN17',
    rungs: [primary('VIN17')],
    lambdas: [{ name: 'vin17-lambda-dev-api', region: 'eu-central-1' }],
    fallbackSupported: false,
  },
  {
    id: 'tivtaam',
    nameHe: 'טיב טעם',
    nameEn: "Tiv Ta'am",
    rungs: [{ ...primary('TIVTAAM', 'TIVTAAM_EMAIL', 'TIVTAAM_PASSWORD') }],
    lambdas: [{ name: 'tivtaam-cart-service-dev-api', region: 'il-central-1' }],
    fallbackSupported: false,
    readOnlyReasonHe: 'הסורק לא קורא את הסוד — הפרטים נצרבים בזמן הפריסה. שינוי כאן לא ישפיע.',
    readOnlyReasonEn: 'This scanner does not read the secret — its login is baked in at deploy. A change here would have no effect.',
  },
]

export function providerById(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

export interface RungMeta {
  changedAt?: string
  changedBy?: string
}

export interface RungView {
  id: string
  kind: RungKind
  labelHe: string
  labelEn: string
  toggleable: boolean
  username: string
  hasPassword: boolean
  /** The scanner will try this rung (both keys live and non-empty). */
  active: boolean
  /** Switched off here — keys parked under __OFF. */
  parked: boolean
  /** Same username as an earlier account of the same kind: the scanner skips it (id of that account). */
  sameAs?: string
  meta: RungMeta
}

export interface ProviderView {
  id: string
  nameHe: string
  nameEn: string
  lambdas: LambdaRef[]
  fallbackSupported: boolean
  readOnly: boolean
  readOnlyReasonHe?: string
  readOnlyReasonEn?: string
  noteHe?: string
  noteEn?: string
  rungs: RungView[]
}

type Meta = Record<string, Record<string, RungMeta>>

export function readMeta(values: Record<string, string>): Meta {
  try {
    const parsed = JSON.parse(values[META_KEY] || '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Meta) : {}
  } catch {
    return {}
  }
}

const nonEmpty = (v: string | undefined) => typeof v === 'string' && v.trim() !== ''

/** What the browser may see: usernames and whether a password is set — never a password. */
export function buildView(values: Record<string, string>): ProviderView[] {
  const meta = readMeta(values)
  return PROVIDERS.map((p) => ({
    id: p.id,
    nameHe: p.nameHe,
    nameEn: p.nameEn,
    lambdas: p.lambdas,
    fallbackSupported: p.fallbackSupported,
    readOnly: !!p.readOnlyReasonEn,
    readOnlyReasonHe: p.readOnlyReasonHe,
    readOnlyReasonEn: p.readOnlyReasonEn,
    noteHe: p.noteHe,
    noteEn: p.noteEn,
    rungs: p.rungs.map((r, i) => {
      const liveUser = values[r.userKey]
      const livePass = values[r.passKey]
      const parkedUser = values[r.userKey + PARKED_SUFFIX]
      const parkedPass = values[r.passKey + PARKED_SUFFIX]
      const parked = !nonEmpty(liveUser) && !nonEmpty(livePass) && (nonEmpty(parkedUser) || nonEmpty(parkedPass))
      // The PSA ladder only drops to a fallback whose username differs from the
      // account it is leaving (session_manager `_swap_to_fallback_credentials`),
      // so a duplicate is a rung that can never be reached.
      const sameAs = p.rungs.slice(0, i).find(
        (e) => e.kind === r.kind && nonEmpty(liveUser) && values[e.userKey]?.trim() === liveUser.trim(),
      )?.id
      return {
        id: r.id,
        kind: r.kind,
        labelHe: r.labelHe,
        labelEn: r.labelEn,
        toggleable: r.toggleable,
        username: (parked ? parkedUser : liveUser) ?? '',
        hasPassword: nonEmpty(parked ? parkedPass : livePass),
        active: nonEmpty(liveUser) && nonEmpty(livePass) && !sameAs,
        parked,
        ...(sameAs ? { sameAs } : {}),
        meta: meta[p.id]?.[r.id] ?? {},
      }
    }),
  }))
}

export type Change =
  | { op: 'set'; rung: string; username?: string; password?: string }
  | { op: 'toggle'; rung: string; enabled: boolean }
  | { op: 'swap'; a: string; b: string }

export class ChangeError extends Error {}

/** The secret with one change applied. Returns new values; never mutates the input. */
export function applyChange(
  values: Record<string, string>,
  providerId: string,
  change: Change,
  who: string,
  now: Date,
): { values: Record<string, string>; touched: string[] } {
  const p = providerById(providerId)
  if (!p) throw new ChangeError(`unknown provider: ${providerId}`)
  if (p.readOnlyReasonEn) throw new ChangeError(`${p.nameEn} is not editable here`)
  const rung = (id: string) => {
    const r = p.rungs.find((x) => x.id === id)
    if (!r) throw new ChangeError(`unknown account: ${id}`)
    return r
  }
  const next = { ...values }
  const touched: string[] = []
  const stamp: string[] = []
  const isParked = (r: RungDef) =>
    !nonEmpty(next[r.userKey]) && !nonEmpty(next[r.passKey]) &&
    (nonEmpty(next[r.userKey + PARKED_SUFFIX]) || nonEmpty(next[r.passKey + PARKED_SUFFIX]))
  const put = (k: string, v: string) => { next[k] = v; touched.push(k) }
  const drop = (k: string) => { if (k in next) { delete next[k]; touched.push(k) } }

  if (change.op === 'set') {
    const r = rung(change.rung)
    // A parked rung is edited in place, so switching it on later brings the new value.
    const parked = isParked(r)
    const uk = parked ? r.userKey + PARKED_SUFFIX : r.userKey
    const pk = parked ? r.passKey + PARKED_SUFFIX : r.passKey
    if (change.username !== undefined) {
      const u = change.username.trim()
      if (!u) throw new ChangeError('username cannot be empty')
      put(uk, u)
    }
    if (change.password !== undefined) {
      if (!change.password) throw new ChangeError('password cannot be empty')
      put(pk, change.password)
    }
    if (!touched.length) throw new ChangeError('nothing to change')
    stamp.push(r.id)
  } else if (change.op === 'toggle') {
    const r = rung(change.rung)
    if (!r.toggleable) throw new ChangeError(`${r.labelEn} cannot be switched off`)
    const parked = isParked(r)
    if (change.enabled && parked) {
      for (const k of [r.userKey, r.passKey]) {
        put(k, next[k + PARKED_SUFFIX] ?? '')
        drop(k + PARKED_SUFFIX)
      }
    } else if (!change.enabled && !parked) {
      if (!nonEmpty(next[r.userKey]) && !nonEmpty(next[r.passKey])) {
        throw new ChangeError(`${r.labelEn} has no account to switch off`)
      }
      for (const k of [r.userKey, r.passKey]) {
        put(k + PARKED_SUFFIX, next[k] ?? '')
        drop(k)
      }
    } else {
      throw new ChangeError(`${r.labelEn} is already ${change.enabled ? 'on' : 'off'}`)
    }
    stamp.push(r.id)
  } else {
    const a = rung(change.a)
    const b = rung(change.b)
    if (a.kind !== b.kind || a.id === b.id) throw new ChangeError('only two accounts of the same kind can swap order')
    if (isParked(a) || isParked(b)) throw new ChangeError('switch both accounts on before swapping their order')
    const [au, ap, bu, bp] = [next[a.userKey], next[a.passKey], next[b.userKey], next[b.passKey]]
    if (!nonEmpty(au) || !nonEmpty(bu)) throw new ChangeError('both accounts need a username to swap')
    put(a.userKey, bu); put(a.passKey, bp ?? '')
    put(b.userKey, au); put(b.passKey, ap ?? '')
    stamp.push(a.id, b.id)
  }

  const meta = readMeta(next)
  meta[p.id] = { ...(meta[p.id] ?? {}) }
  for (const id of stamp) meta[p.id][id] = { changedAt: now.toISOString(), changedBy: who }
  next[META_KEY] = JSON.stringify(meta)
  touched.push(META_KEY)
  return { values: next, touched: [...new Set(touched)] }
}

/** The password of one rung (live or parked), for an explicit, password-gated reveal. */
export function revealPassword(values: Record<string, string>, providerId: string, rungId: string): string {
  const p = providerById(providerId)
  const r = p?.rungs.find((x) => x.id === rungId)
  if (!p || !r) throw new ChangeError('unknown account')
  return values[r.passKey] || values[r.passKey + PARKED_SUFFIX] || ''
}
