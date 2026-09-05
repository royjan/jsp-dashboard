'use client'

/**
 * The entrance the library already described and never shipped.
 *
 * `motion.ts` has carried `fadeUp`, `staggerContainer` and `cardVariants` since
 * the beginning, and its own comment records that TEN pages redefined
 * `const cardVariants: any` locally, each with its own `eslint-disable`. The
 * variants were never the missing piece — a component that runs them on entry
 * was.
 *
 * TWO RULES THAT ARE NOT DECORATION.
 *
 * ONCE. A row animates the first time it is seen and never again. A table that
 * re-runs its entrance every time it scrolls back into view reads as a page that
 * keeps reloading, and on a screen someone works in all day that is exhausting.
 *
 * A CEILING ON THE STAGGER. At 50ms a step, a 60-row table finishes three
 * seconds after it started and the last row arrives long after the reader has
 * begun looking for it. Past `MAX_STAGGERED` the delay is dropped and everything
 * lands together — which is also the honest answer, because past that point the
 * sequence is not conveying order to anyone.
 */

import * as React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { DURATION, EASE, STAGGER } from './motion'
import { cn } from './cn'

/** Beyond this many children the stagger is dropped rather than stretched. */
export const MAX_STAGGERED = 24

export interface RevealProps {
  children: React.ReactNode
  className?: string
  /** Seconds before this element starts. */
  delay?: number
  /** How far it travels, in px. 0 is a plain fade — right for dense tables. */
  distance?: number
  as?: 'div' | 'section' | 'li' | 'tr'
}

export function Reveal({ children, className, delay = 0, distance = 10, as = 'div' }: RevealProps) {
  const reduce = useReducedMotion()
  const Tag = motion[as]
  return (
    <Tag
      className={className}
      initial={reduce ? false : { opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -40px 0px' }}
      transition={{ duration: DURATION.base, ease: EASE, delay }}
    >
      {children}
    </Tag>
  )
}

export interface RevealListProps {
  children: React.ReactNode
  className?: string
  /** Seconds between children. Ignored past MAX_STAGGERED children. */
  step?: number
  as?: 'div' | 'ul' | 'tbody'
}

/**
 * A container whose children arrive in order. Children are wrapped here rather
 * than by the caller, so a list does not have to know anything about motion.
 */
export function RevealList({ children, className, step = STAGGER, as = 'div' }: RevealListProps) {
  const reduce = useReducedMotion()
  const items = React.Children.toArray(children)
  const stagger = items.length > MAX_STAGGERED ? 0 : step
  const Tag = motion[as]

  return (
    <Tag
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '0px 0px -40px 0px' }}
      variants={{ hidden: {}, visible: { transition: { staggerChildren: reduce ? 0 : stagger } } }}
    >
      {items.map((child, i) => (
        <motion.div
          key={i}
          className={cn('min-w-0')}
          variants={{
            hidden: reduce ? { opacity: 1 } : { opacity: 0, y: 9 },
            visible: { opacity: 1, y: 0, transition: { duration: DURATION.base, ease: EASE } },
          }}
        >
          {child}
        </motion.div>
      ))}
    </Tag>
  )
}

export default Reveal
