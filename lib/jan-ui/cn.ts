import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Same `cn` the dashboard uses. Ported rather than imported so the package
 *  has no path back into any one app. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
