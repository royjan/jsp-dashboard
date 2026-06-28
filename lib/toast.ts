/**
 * Toast notification utility (ported from jsp-chat-js).
 * Unified toast API over sonner for the integrated chat-admin UI.
 */

import { toast as sonnerToast, type ExternalToast } from 'sonner'

export interface ToastOptions extends Omit<ExternalToast, 'action'> {
  description?: string
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

export interface ErrorToastOptions extends ToastOptions {
  retry?: () => void
}

export const toast = {
  success: (message: string, options?: ToastOptions) =>
    sonnerToast.success(message, {
      description: options?.description,
      duration: options?.duration ?? 4000,
      action: options?.action
        ? { label: options.action.label, onClick: options.action.onClick }
        : undefined,
    }),

  error: (message: string, options?: ErrorToastOptions) =>
    sonnerToast.error(message, {
      description: options?.description,
      duration: options?.duration ?? 6000,
      action: options?.retry
        ? { label: 'Retry', onClick: options.retry }
        : options?.action
          ? { label: options.action.label, onClick: options.action.onClick }
          : undefined,
    }),

  warning: (message: string, options?: ToastOptions) =>
    sonnerToast.warning(message, {
      description: options?.description,
      duration: options?.duration ?? 5000,
      action: options?.action
        ? { label: options.action.label, onClick: options.action.onClick }
        : undefined,
    }),

  info: (message: string, options?: ToastOptions) =>
    sonnerToast.info(message, {
      description: options?.description,
      duration: options?.duration ?? 4000,
      action: options?.action
        ? { label: options.action.label, onClick: options.action.onClick }
        : undefined,
    }),

  loading: (message: string, options?: Omit<ToastOptions, 'action'>) =>
    sonnerToast.loading(message, {
      description: options?.description,
      duration: options?.duration ?? Infinity,
    }),

  dismiss: (id?: string | number) => {
    sonnerToast.dismiss(id)
  },

  promise: <T>(
    promise: Promise<T>,
    messages: {
      loading: string
      success: string | ((data: T) => string)
      error: string | ((error: unknown) => string)
    },
  ) => sonnerToast.promise(promise, messages),

  custom: (message: string, options?: ExternalToast) => sonnerToast(message, options),
}
