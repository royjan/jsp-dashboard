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
