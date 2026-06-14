/**
 * Notification sender for stock alerts.
 * Uses Resend if RESEND_API_KEY is set, otherwise logs to console.
 */
import type { AlertFiring } from './stock-alerts'

const ILS = (n: number) =>
  new Intl.NumberFormat('he-IL', { minimumFractionDigits: 0 }).format(n)

export async function sendAlertEmail(
  firing: AlertFiring,
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.ALERTS_FROM_EMAIL || 'alerts@jan.parts'

  const subject = `[Stock Alert] ${firing.itemCode} — ${firing.itemName || 'item'} at ${ILS(firing.stockQty)} units`
  const bodyText = [
    `Rule: ${firing.ruleName}`,
    `Item: ${firing.itemCode} (${firing.itemName || 'unknown'})`,
    `Current stock: ${firing.stockQty}`,
    `Threshold: ${firing.thresholdQty}`,
    ``,
    `View in dashboard: https://dashboard.jan.parts/stock?item=${firing.itemCode}`,
  ].join('\n')

  if (!apiKey) {
    // Dev mode: log only
    console.log('[Notifications] No RESEND_API_KEY — would send:', {
      to: firing.recipients,
      subject,
      bodyText,
    })
    return { ok: true }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: firing.recipients,
        subject,
        text: bodyText,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      return { ok: false, error: `Resend ${res.status}: ${err.slice(0, 200)}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
