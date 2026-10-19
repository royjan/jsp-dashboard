/**
 * Scanner portal accounts — the logins each scraper Lambda uses, in the order it
 * tries them. Pure: the API route reads/writes the `config` secret and hands
 * the values here, so everything below is testable without AWS.
 *
 * STORAGE. One key per provider holds an ordered JSON list, e.g. PSA_ACCOUNTS:
 *   [{ id, username, password, enabled, portal, changedAt?, changedBy? }, ...]
 * List order IS login order — the first usable account is the primary, there is no flag: the scanner tries the first enabled account, and
 * on a failed login moves to the next (up to MAX_ACCOUNTS: a primary + 5
 * fallbacks). Disabled accounts, and a repeat of an earlier portal+username,
 * are skipped. `portal` is only meaningful for PSA, where "public" accounts log
 * in to the independent-operator portal instead of the dealer one.
 *
 * MIRROR. Every write also refreshes the provider's old fixed keys
 * (PSA_USERNAME/PASSWORD = first usable dealer account, _FALLBACK = the second,
 * _PUBLIC = the first public one), so anything that has not learned the list —
 * psa-catalog, a rolled-back image, a scanner not updated yet — keeps working
 * on the same accounts it always had. A provider with no list key yet is read
 * from those old keys, so the first save here migrates it.
 *
 * Scanners read the secret once per container; the API route recycles them
 * ("apply now") so a change takes effect for new scans.
 */

export type Portal = 'dealer' | 'public'

export const MAX_ACCOUNTS = 6
export const PARKED_SUFFIX = '__OFF' // written by an earlier version of this page; cleaned up on save
/** { providerId: ISO time of its last change } — tells whether its scanners have picked it up. */
export const CHANGED_KEY = 'SCANNER_ACCOUNTS_CHANGED'

export interface LambdaRef {
  name: string
  region: string
}

interface LegacySlot {
  userKey: string
  passKey: string
}

export interface ProviderDef {
  id: string
  nameHe: string
  nameEn: string
  accountsKey: string
  legacy: { primary: LegacySlot; fallback?: LegacySlot; public?: LegacySlot }
  portals: Portal[]
  lambdas: LambdaRef[]
  /** The deployed scanner walks the whole list (else only the mirrored old keys). */
  scannerReadsList: boolean
  /**
   * On-prem consumers that read logins from the office Redis instead of the
   * secret (portal-pilot on .179 and the psa-native walkers on the VPS).
   */
  onPrem?: { prefix: string; listKey: string; mirror: { key: string; take: 'dealer1' | 'dealer2' | 'public1' }[] }
  readOnlyReasonHe?: string
  readOnlyReasonEn?: string
  noteHe?: string
  noteEn?: string
}

const slot = (userKey: string, passKey: string): LegacySlot => ({ userKey, passKey })

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'psa',
    nameHe: 'PSA · ServiceBox',
    nameEn: 'PSA · ServiceBox',
    accountsKey: 'PSA_ACCOUNTS',
    legacy: {
      primary: slot('PSA_USERNAME', 'PSA_PASSWORD'),
      fallback: slot('PSA_USERNAME_FALLBACK', 'PSA_PASSWORD_FALLBACK'),
      public: slot('PSA_USERNAME_PUBLIC', 'PSA_PASSWORD_PUBLIC'),
    },
    portals: ['dealer', 'public'],
    lambdas: [
      { name: 'psa-vehicle-service-lambda-dev-api', region: 'eu-west-3' },
      { name: 'psa-catalog-service-lambda-dev-api', region: 'eu-west-3' },
    ],
    scannerReadsList: true,
    onPrem: {
      prefix: 'portal-pilot:creds:',
      listKey: 'psa_accounts',
      mirror: [
        { key: 'psa', take: 'dealer1' }, // the .179 keeper
        { key: 'psa_worker', take: 'dealer1' }, // the VPS walkers' primary (PP_PSA_ACCOUNT)
        { key: 'psa_fallback', take: 'dealer2' }, // walkers' fallback + the .179 verifier pool
        { key: 'psa_public', take: 'public1' },
      ],
    },
    noteHe: 'פורטל ציבורי מתחבר ומחפש חלקים, אבל לא יכול להריץ סריקה מלאה. סורק שעבר לחשבון גיבוי נשאר עליו עד שמרעננים אותו. psa-catalog משתמש רק בחשבון הסוכן הראשון. portal-pilot (דייגו) וסורקי ה-VPS מקבלים עותק ב-Redis בכל שמירה.',
    noteEn: 'A public-portal account can sign in and look up parts but cannot run a full scan. A scanner that moved to a fallback stays on it until refreshed. psa-catalog only uses the first dealer account. portal-pilot (Diego) and the VPS walkers get a copy in Redis on every save.',
  },
  {
    id: 'partslink',
    nameHe: 'PartsLink24 · טויוטה',
    nameEn: 'PartsLink24 · Toyota',
    accountsKey: 'PARTSLINK_ACCOUNTS',
    legacy: { primary: slot('PARTSLINK_USERNAME', 'PARTSLINK_PASSWORD') },
    portals: ['dealer'],
    lambdas: [
      { name: 'partslink-vehicle-service-lambda-dev-api', region: 'eu-central-1' },
      { name: 'partslink-vehicle-service-lambda-hk-api', region: 'eu-central-1' },
    ],
    scannerReadsList: false,
    noteHe: 'כל חשבון מאפשר חיבור אחד בכל פעם.',
    noteEn: 'Each account allows one session at a time.',
  },
  {
    id: 'saic',
    nameHe: 'SAIC · MG',
    nameEn: 'SAIC · MG',
    accountsKey: 'SAIC_ACCOUNTS',
    legacy: { primary: slot('SAIC_USERNAME', 'SAIC_PASSWORD') },
    portals: ['dealer'],
    lambdas: [
      { name: 'saic-vehicle-service-lambda-prod-api', region: 'ap-northeast-2' },
      { name: 'saic-vehicle-service-lambda-prod-orchestrator', region: 'ap-northeast-2' },
    ],
    scannerReadsList: false,
  },
  {
    id: 'qipei',
    nameHe: 'Qipei · cii.me',
    nameEn: 'Qipei · cii.me',
    accountsKey: 'QIPEI_ACCOUNTS',
    legacy: { primary: slot('QIPEI_CII_ME_USERNAME', 'QIPEI_CII_ME_PASSWORD') },
    portals: ['dealer'],
    lambdas: [{ name: 'qipei-vehicle-service-lambda-dev-api', region: 'eu-central-1' }],
    scannerReadsList: false,
  },
  {
    id: 'vin17',
    nameHe: 'VIN17',
    nameEn: 'VIN17',
    accountsKey: 'VIN17_ACCOUNTS',
    legacy: { primary: slot('VIN17_USERNAME', 'VIN17_PASSWORD') },
    portals: ['dealer'],
    lambdas: [{ name: 'vin17-lambda-dev-api', region: 'eu-central-1' }],
    scannerReadsList: false,
  },
  {
    id: 'tivtaam',
    nameHe: 'טיב טעם',
    nameEn: "Tiv Ta'am",
    accountsKey: 'TIVTAAM_ACCOUNTS',
    legacy: { primary: slot('TIVTAAM_EMAIL', 'TIVTAAM_PASSWORD') },
    portals: ['dealer'],
    lambdas: [{ name: 'tivtaam-cart-service-dev-api', region: 'il-central-1' }],
    scannerReadsList: false,
    readOnlyReasonHe: 'הסורק לא קורא את הסוד — הפרטים נצרבים בזמן הפריסה. שינוי כאן לא ישפיע.',
    readOnlyReasonEn: 'This scanner does not read the secret — its login is baked in at deploy. A change here would have no effect.',
  },
]

export function providerById(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

export interface StoredAccount {
  id: string
  username: string
  password: string
  enabled: boolean
  portal: Portal
  changedAt?: string
  changedBy?: string
}

export interface AccountView {
  id: string
  username: string
  hasPassword: boolean
  enabled: boolean
  portal: Portal
  changedAt?: string
  changedBy?: string
  /** Earlier account with the same portal+username — the scanner skips this one. */
  sameAs?: string
  /** The deployed scanner will try this account (in this list's order). */
  usedNow: boolean
}

export interface ProviderView {
  id: string
  nameHe: string
  nameEn: string
  lambdas: LambdaRef[]
  portals: Portal[]
  maxAccounts: number
  scannerReadsList: boolean
  /** Still stored only in the old fixed keys — the first save here migrates it. */
  legacyOnly: boolean
  /** Last change to this provider's accounts (any add/edit/delete/move). */
  changedAt?: string
  /** Has on-prem consumers reading Redis (see ProviderDef.onPrem). */
  hasOnPrem: boolean
  readOnly: boolean
  readOnlyReasonHe?: string
  readOnlyReasonEn?: string
  noteHe?: string
  noteEn?: string
  accounts: AccountView[]
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const sameLogin = (a: StoredAccount, b: StoredAccount) =>
  a.portal === b.portal && a.username.trim().toLowerCase() === b.username.trim().toLowerCase()

function newId(taken: Set<string>): string {
  for (let i = 1; ; i++) if (!taken.has(`a${i}`)) return `a${i}`
}

/** The provider's accounts: the list key if present, else derived from the old fixed keys. */
export function readAccounts(values: Record<string, string>, p: ProviderDef): { accounts: StoredAccount[]; legacyOnly: boolean } {
  const raw = values[p.accountsKey]
  if (nonEmpty(raw)) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        const taken = new Set<string>()
        const accounts = parsed
          .filter((a) => a && typeof a === 'object')
          .map((a): StoredAccount => {
            const id = nonEmpty(a.id) && !taken.has(a.id) ? a.id : newId(taken)
            taken.add(id)
            return {
              id,
              username: String(a.username ?? ''),
              password: String(a.password ?? ''),
              enabled: a.enabled !== false,
              portal: a.portal === 'public' && p.portals.includes('public') ? 'public' : 'dealer',
              ...(nonEmpty(a.changedAt) ? { changedAt: String(a.changedAt) } : {}),
              ...(nonEmpty(a.changedBy) ? { changedBy: String(a.changedBy) } : {}),
            }
          })
        return { accounts, legacyOnly: false }
      }
    } catch {
      // A hand-mangled list: fall through to the old keys, which the mirror kept in step.
    }
  }
  const accounts: StoredAccount[] = []
  const from = (s: LegacySlot | undefined, portal: Portal, id: string) => {
    if (!s) return
    const live = nonEmpty(values[s.userKey]) || nonEmpty(values[s.passKey])
    const user = live ? values[s.userKey] : values[s.userKey + PARKED_SUFFIX]
    const pass = live ? values[s.passKey] : values[s.passKey + PARKED_SUFFIX]
    if (!nonEmpty(user) && !nonEmpty(pass)) return
    accounts.push({ id, username: user ?? '', password: pass ?? '', enabled: live, portal })
  }
  from(p.legacy.primary, 'dealer', 'a1')
  from(p.legacy.fallback, 'dealer', 'a2')
  from(p.legacy.public, 'public', 'a3')
  return { accounts, legacyOnly: true }
}

/** Enabled, complete, and not a repeat of an earlier login — what a list-reading scanner walks. */
export function usableAccounts(accounts: StoredAccount[]): StoredAccount[] {
  const out: StoredAccount[] = []
  for (const a of accounts) {
    if (!a.enabled || !nonEmpty(a.username) || !nonEmpty(a.password)) continue
    if (out.some((b) => sameLogin(a, b))) continue
    out.push(a)
  }
  return out
}

/** Which accounts land in the old fixed keys (what a scanner that has not learned the list uses). */
export function mirrorPlan(p: ProviderDef, accounts: StoredAccount[]): { slot: LegacySlot; account: StoredAccount | null }[] {
  const usable = usableAccounts(accounts)
  const dealers = usable.filter((a) => a.portal === 'dealer')
  const plan: { slot: LegacySlot; account: StoredAccount | null }[] = [{ slot: p.legacy.primary, account: dealers[0] ?? null }]
  if (p.legacy.fallback) plan.push({ slot: p.legacy.fallback, account: dealers[1] ?? null })
  if (p.legacy.public) plan.push({ slot: p.legacy.public, account: usable.find((a) => a.portal === 'public') ?? null })
  return plan
}

/** What the browser may see: never a password. */
function readChanged(values: Record<string, string>): Record<string, string> {
  try {
    const parsed = JSON.parse(values[CHANGED_KEY] || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function buildView(values: Record<string, string>): ProviderView[] {
  const changed = readChanged(values)
  return PROVIDERS.map((p) => {
    const { accounts, legacyOnly } = readAccounts(values, p)
    const usable = new Set(usableAccounts(accounts).map((a) => a.id))
    const mirrored = new Set(mirrorPlan(p, accounts).map((m) => m.account?.id).filter(Boolean))
    return {
      id: p.id,
      nameHe: p.nameHe,
      nameEn: p.nameEn,
      lambdas: p.lambdas,
      portals: p.portals,
      maxAccounts: MAX_ACCOUNTS,
      scannerReadsList: p.scannerReadsList,
      legacyOnly,
      ...(changed[p.id] ? { changedAt: changed[p.id] } : {}),
      hasOnPrem: !!p.onPrem,
      readOnly: !!p.readOnlyReasonEn,
      readOnlyReasonHe: p.readOnlyReasonHe,
      readOnlyReasonEn: p.readOnlyReasonEn,
      noteHe: p.noteHe,
      noteEn: p.noteEn,
      accounts: accounts.map((a, i) => {
        const sameAs = a.enabled && nonEmpty(a.username)
          ? accounts.slice(0, i).find((b) => b.enabled && sameLogin(a, b))?.id
          : undefined
        return {
          id: a.id,
          username: a.username,
          hasPassword: nonEmpty(a.password),
          enabled: a.enabled,
          portal: a.portal,
          ...(a.changedAt ? { changedAt: a.changedAt } : {}),
          ...(a.changedBy ? { changedBy: a.changedBy } : {}),
          ...(sameAs ? { sameAs } : {}),
          usedNow: p.scannerReadsList ? usable.has(a.id) : mirrored.has(a.id),
        }
      }),
    }
  })
}

export type Change =
  | { op: 'add'; username: string; password: string; portal?: Portal }
  | { op: 'update'; id: string; username?: string; password?: string }
  | { op: 'delete'; id: string }
  | { op: 'toggle'; id: string; enabled: boolean }
  | { op: 'move'; id: string; to: number }

export class ChangeError extends Error {}

/** The secret with one change applied (list key + mirrored old keys). Never mutates the input. */
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

  const accounts = readAccounts(values, p).accounts.map((a) => ({ ...a }))
  const stamp = (a: StoredAccount) => { a.changedAt = now.toISOString(); a.changedBy = who }
  const find = (id: string) => {
    const a = accounts.find((x) => x.id === id)
    if (!a) throw new ChangeError('unknown account')
    return a
  }
  const clash = (cand: StoredAccount) => accounts.find((b) => b.id !== cand.id && sameLogin(cand, b))

  switch (change.op) {
    case 'add': {
      if (accounts.length >= MAX_ACCOUNTS) throw new ChangeError(`at most ${MAX_ACCOUNTS} accounts (a primary and ${MAX_ACCOUNTS - 1} fallbacks)`)
      const portal: Portal = change.portal === 'public' && p.portals.includes('public') ? 'public' : 'dealer'
      if (!nonEmpty(change.username)) throw new ChangeError('username cannot be empty')
      if (!nonEmpty(change.password)) throw new ChangeError('password cannot be empty')
      const a: StoredAccount = {
        id: newId(new Set(accounts.map((x) => x.id))),
        username: change.username.trim(),
        password: change.password,
        enabled: true,
        portal,
      }
      if (clash(a)) throw new ChangeError('this account is already in the list')
      stamp(a)
      accounts.push(a)
      break
    }
    case 'update': {
      const a = find(change.id)
      if (change.username !== undefined) {
        if (!nonEmpty(change.username)) throw new ChangeError('username cannot be empty')
        a.username = change.username.trim()
      }
      if (change.password !== undefined) {
        if (!nonEmpty(change.password)) throw new ChangeError('password cannot be empty')
        a.password = change.password
      }
      if (clash(a)) throw new ChangeError('another account already uses this username')
      stamp(a)
      break
    }
    case 'delete': {
      const i = accounts.findIndex((x) => x.id === change.id)
      if (i < 0) throw new ChangeError('unknown account')
      accounts.splice(i, 1)
      break
    }
    case 'toggle': {
      const a = find(change.id)
      a.enabled = change.enabled
      stamp(a)
      break
    }
    case 'move': {
      const i = accounts.findIndex((x) => x.id === change.id)
      if (i < 0) throw new ChangeError('unknown account')
      const to = Math.max(0, Math.min(accounts.length - 1, Math.trunc(change.to)))
      const [a] = accounts.splice(i, 1)
      accounts.splice(to, 0, a)
      stamp(a)
      break
    }
  }

  // The old keys need a dealer account to mirror, and a scanner with none could not log in at all.
  if (!usableAccounts(accounts).some((a) => a.portal === 'dealer')) {
    throw new ChangeError(
      p.portals.includes('public')
        ? 'keep at least one enabled dealer account'
        : 'keep at least one enabled account',
    )
  }

  const next = { ...values }
  const touched = new Set<string>()
  next[p.accountsKey] = JSON.stringify(accounts)
  touched.add(p.accountsKey)
  next[CHANGED_KEY] = JSON.stringify({ ...readChanged(values), [p.id]: now.toISOString() })
  touched.add(CHANGED_KEY)
  for (const { slot: s, account } of mirrorPlan(p, accounts)) {
    for (const k of [s.userKey + PARKED_SUFFIX, s.passKey + PARKED_SUFFIX]) {
      if (k in next) { delete next[k]; touched.add(k) }
    }
    if (account) {
      if (next[s.userKey] !== account.username) { next[s.userKey] = account.username; touched.add(s.userKey) }
      if (next[s.passKey] !== account.password) { next[s.passKey] = account.password; touched.add(s.passKey) }
    } else {
      for (const k of [s.userKey, s.passKey]) if (k in next) { delete next[k]; touched.add(k) }
    }
  }
  return { values: next, touched: [...touched] }
}

/**
 * The Redis writes that keep a provider's on-prem consumers in step: the list
 * itself plus the per-role keys they read today ({"username","password"}, the
 * shape portal-pilot's store.set_creds writes). null = delete the key.
 */
export function onPremWrites(p: ProviderDef, accounts: StoredAccount[]): Record<string, string | null> {
  if (!p.onPrem) return {}
  const usable = usableAccounts(accounts)
  const dealers = usable.filter((a) => a.portal === 'dealer')
  const pick = { dealer1: dealers[0], dealer2: dealers[1], public1: usable.find((a) => a.portal === 'public') }
  const out: Record<string, string | null> = {
    [p.onPrem.prefix + p.onPrem.listKey]: onPremList(accounts),
  }
  for (const m of p.onPrem.mirror) {
    const a = pick[m.take]
    out[p.onPrem.prefix + m.key] = a ? JSON.stringify({ username: a.username, password: a.password }) : null
  }
  return out
}

/** The list as the on-prem copy holds it — no audit fields, so it can be compared with the secret's. */
export function onPremList(accounts: StoredAccount[]): string {
  return JSON.stringify(accounts.map(({ id, username, password, enabled, portal }) => ({
    id, username, password, enabled, portal,
  })))
}

/** One account's password, for an explicit, password-gated reveal. */
export function revealPassword(values: Record<string, string>, providerId: string, accountId: string): string {
  const p = providerById(providerId)
  if (!p) throw new ChangeError('unknown provider')
  const a = readAccounts(values, p).accounts.find((x) => x.id === accountId)
  if (!a) throw new ChangeError('unknown account')
  return a.password
}
