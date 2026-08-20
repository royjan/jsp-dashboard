'use client'

import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLocale } from '@/lib/locale-context'
import { toggleMoneyHidden } from '@/lib/privacy'
import { useMoneyHidden } from '@/lib/use-money-hidden'

/**
 * The demo-mode eye. Closed eye (the default) = money is masked AND declines
 * are suppressed; open eye = the real dashboard.
 *
 * Declines are hidden, growth is not — Roy's call for demos. That asymmetry is
 * deliberate and worth knowing: with the eye closed, every trend still on
 * screen is a positive one.
 *
 * Deliberately styled louder than its neighbours when revealed: showing real
 * revenue on a shared screen is the dangerous state, so it is the one that
 * has to be visible from across the room.
 */
export function MoneyToggle({ labelled = false }: { labelled?: boolean }) {
  const hidden = useMoneyHidden()
  const { t } = useLocale()
  const label = hidden ? t('showMoney') : t('hideMoney')

  return (
    <Button
      variant="ghost"
      size={labelled ? 'sm' : 'icon'}
      onClick={() => toggleMoneyHidden()}
      title={label}
      aria-label={label}
      aria-pressed={!hidden}
      className={
        (labelled ? 'gap-1.5 text-xs ' : '') +
        (hidden ? 'text-muted-foreground' : 'text-amber-500 hover:text-amber-500')
      }
    >
      {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      <span className={labelled ? undefined : 'sr-only'}>{label}</span>
    </Button>
  )
}
