/**
 * Copy text to the clipboard, on origins where the modern API does not exist.
 *
 * Every Jan surface is reached over plain http:// on the LAN — the dashboard on
 * :3002, partly on :3001, the portal on :8090, Diego v4 on :8768. None of those
 * is a secure context, and Chrome gates `navigator.clipboard` on
 * `isSecureContext` (the same gate that makes the microphone unavailable to
 * Diego's voice console). On those origins the property is simply undefined, so
 * a button written the modern way throws on first click — or worse, does
 * nothing and looks like it worked.
 *
 * So the deprecated path is the PRIMARY one in practice: a throwaway
 * <textarea>, select, `document.execCommand('copy')`. It is deprecated, it is
 * also the only thing that works on an insecure origin, and it works in every
 * browser this fleet is looked at from.
 *
 * The modern API is still tried first, because over a tunnelled localhost (the
 * documented way to get Diego's mic working) the context IS secure and the real
 * API is the better one. It is tried inside a try/catch rather than behind an
 * `isSecureContext` check: some contexts expose the property and refuse the
 * write, and only the catch covers that.
 *
 * Returns whether the copy actually happened. Callers should say so — a silent
 * failure is the one useless outcome, because the whole failure mode this
 * guards against is a copy that quietly did not occur.
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* denied, or an insecure context that exposes the property but refuses the write */
    }
  }
  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false
  const ta = document.createElement('textarea')
  ta.value = text
  // Off-screen but still focusable — display:none or visibility:hidden makes
  // the selection empty and the copy a silent no-op.
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '-1000px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  try {
    ta.select()
    ta.setSelectionRange(0, ta.value.length) // iOS ignores select() on its own
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(ta)
  }
}
