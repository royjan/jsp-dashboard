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
