import type { Variants, Transition } from 'framer-motion'

/**
 * Shared motion spec — one easing curve, a small duration scale and a default stagger,
 * so animations feel like one app instead of per-page ad-hoc values. Framer Motion's
 * reduced-motion handling is global via <MotionConfig reducedMotion="user"> in providers.
 */
export const EASE: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94]

export const DURATION = { fast: 0.15, base: 0.3, slow: 0.4 } as const

export const STAGGER = 0.05

export const pageTransition: Transition = { duration: DURATION.fast, ease: EASE }

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE } },
}

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.base, ease: EASE } },
}

/** A container whose children animate in with a stagger (children use `fadeUp`/`fadeIn`). */
export function staggerContainer(stagger: number = STAGGER): Variants {
  return {
    hidden: {},
    visible: { transition: { staggerChildren: stagger } },
  }
}

/**
 * Index-staggered card entrance — the variant 10 pages each redefined locally
 * (as `const cardVariants: any`, with an eslint-disable each time). Drive it
 * with the row index:
 *
 *   <motion.div custom={i} variants={cardVariants} initial="hidden" animate="visible">
 *
 * Typed as Variants; the `custom` callback form is what needs the index.
 */
export const cardVariants: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.98 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { delay: i * STAGGER, duration: DURATION.base, ease: EASE },
  }),
}


/* ═══════════════════════════════════════════════════════════════════════════
   ONE SOURCE FOR THE CURVE.

   The same four values exist twice: here, for anything driven by JavaScript,
   and in tokens.css as --jan-ease / --jan-fast / --jan-base / --jan-slow, for
   anything driven by a transition. Nothing kept them equal. Two of the four
   apps could drift apart by a hundred milliseconds and every review would read
   as "the animations feel a bit off" with nobody able to say why.

   tokens.css is the source. The constants above are the value it is expected to
   hold — they have to be static, because they are read during render and on the
   server, where there is no computed style to ask.

   `syncMotionTokens()` reconciles the two once on the client. In development it
   also says so out loud when they disagree, which is the only moment anyone can
   actually fix it.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Live values. Identical to the constants until the client syncs them. */
export const MOTION: {
  ease: readonly number[]
  fast: number
  base: number
  slow: number
  stagger: number
} = {
  ease: EASE,
  fast: DURATION.fast,
  base: DURATION.base,
  slow: DURATION.slow,
  stagger: STAGGER,
}

const seconds = (v: string, fallback: number): number => {
  const t = v.trim()
  if (!t) return fallback
  const n = parseFloat(t)
  if (!Number.isFinite(n)) return fallback
  return t.endsWith('ms') ? n / 1000 : n
}

/* Four apps, three bundlers, and `process` is a bare identifier in only some of
   them — Vite leaves it undefined in the browser, and referencing it directly
   fails the portal's typecheck. Read it off globalThis and require a positive
   'development' rather than "not production", so a bundler that defines nothing
   stays quiet instead of warning in production. */
const isDev = (): boolean => {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } }
  return g.process?.env?.NODE_ENV === 'development'
}

const cubic = (v: string): number[] | null => {
  const m = v.match(/cubic-bezier\(([^)]+)\)/)
  if (!m) return null
  const parts = m[1].split(',').map((x) => parseFloat(x))
  return parts.length === 4 && parts.every(Number.isFinite) ? parts : null
}

/** Call once on the client, from the provider. Safe to call more than once. */
export function syncMotionTokens(): void {
  if (typeof window === 'undefined') return
  const css = getComputedStyle(document.documentElement)
  const read = (name: string) => css.getPropertyValue(name)

  const ease = cubic(read('--jan-ease'))
  if (ease) MOTION.ease = ease
  MOTION.fast = seconds(read('--jan-fast'), DURATION.fast)
  MOTION.base = seconds(read('--jan-base'), DURATION.base)
  MOTION.slow = seconds(read('--jan-slow'), DURATION.slow)
  MOTION.stagger = seconds(read('--jan-stagger'), STAGGER)

  if (isDev()) {
    const off: string[] = []
    if (ease && ease.some((n, i) => Math.abs(n - EASE[i]) > 1e-4)) off.push(`--jan-ease ${read('--jan-ease').trim()} vs EASE ${EASE.join(',')}`)
    if (Math.abs(MOTION.base - DURATION.base) > 1e-4) off.push(`--jan-base ${MOTION.base}s vs DURATION.base ${DURATION.base}s`)
    if (Math.abs(MOTION.fast - DURATION.fast) > 1e-4) off.push(`--jan-fast ${MOTION.fast}s vs DURATION.fast ${DURATION.fast}s`)
    if (Math.abs(MOTION.slow - DURATION.slow) > 1e-4) off.push(`--jan-slow ${MOTION.slow}s vs DURATION.slow ${DURATION.slow}s`)
    if (off.length) {
      // eslint-disable-next-line no-console
      console.warn('[jan-ui] motion tokens disagree with motion.ts:\n  ' + off.join('\n  '))
    }
  }
}
