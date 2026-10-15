'use client'

import { use } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/lib/locale-context'
import { useBot } from '@/lib/bots-admin'
import { UsageCard, GroupsCard, TelegramCard, PolicyForm, BrandsForm } from '../_parts'

/** /bots/<id>/limit - usage today (raise / reset per person), groups, Telegram, limits, brands. */
export default function LimitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { locale } = useLocale()
  const he = locale === 'he'
  const { data: b } = useBot(id)
  if (!b) return <Skeleton className="h-64" />
  return (
    <div className="space-y-4">
      {b.policy_enforced === false && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          {he ? 'הבוט הזה עדיין לא אוכף הגבלות: אפשר לשמור כאן הגדרות, אבל הן ייכנסו לתוקף רק אחרי שהבוט יקבל את מנגנון ההגבלות.'
              : 'This bot does not enforce limits yet: settings saved here take effect once it gets the policy code.'}
        </p>
      )}
      <UsageCard key={JSON.stringify(b.policy.user_limits ?? {})} id={id} policy={b.policy} he={he} />
      <PolicyForm key={JSON.stringify(b.policy)} id={id} policy={b.policy} he={he} />
      <GroupsCard key={JSON.stringify([b.policy.telegram_groups, b.policy.group_limits])} id={id} policy={b.policy} he={he} />
      {b.telegram_locked ? (
        <p className="rounded-md border p-3 text-sm">
          ✈ {b.telegram.username ? <span dir="ltr">@{b.telegram.username}</span> : null}{' '}
          {b.telegram.running ? (he ? '· פועל' : '· running') : (he ? '· כבוי' : '· stopped')}{' — '}
          {he ? 'הטלגרם של הבוט הזה מנוהל מחוץ לדשבורד.' : "this bot's Telegram is managed outside the dashboard."}
        </p>
      ) : (
        <TelegramCard key={`${b.policy.telegram_auth}|${b.policy.access_code}`} id={id} tg={b.telegram} policy={b.policy} he={he} />
      )}
      <BrandsForm key={JSON.stringify(b.brands)} id={id} brands={b.brands} options={b.brand_options ?? []} he={he} />
    </div>
  )
}
