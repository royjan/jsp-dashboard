/**
 * Client-safe logger (ported from jsp-chat-js logger.client).
 * Console-based; used by the integrated chat-admin components.
 */

type LogContext = Record<string, unknown> | unknown

interface Logger {
  debug: (message: string, ...args: unknown[]) => void
  info: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void
  error: (message: string, ...args: unknown[]) => void
  log: (level: string, message: string, ...args: unknown[]) => void
}

export const logger: Logger = {
  debug: (message: string, ...args: unknown[]) => {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(message, ...args)
    }
  },
  info: (message: string, ...args: unknown[]) => {
    console.log(message, ...args)
  },
  warn: (message: string, ...args: unknown[]) => {
    console.warn(message, ...args)
  },
  error: (message: string, ...args: unknown[]) => {
    console.error(message, ...args)
  },
  log: (level: string, message: string, ...args: unknown[]) => {
    const method = level.toLowerCase() as keyof typeof console
    if (typeof console[method] === 'function') {
      ;(console[method] as (...a: unknown[]) => void)(message, ...args)
    } else {
      console.log(`[${level}] ${message}`, ...args)
    }
  },
}

export type { LogContext }

export default logger
