/** Shared localized recurrence labels for the editor and saved cards. */
import type { AutomationTask } from '../contract.ts'
import { productText as text } from './locales/product.ts'

const labels = {
  daily: () => text('每天'), workdays: () => text('每个工作日'), friday: () => text('每周五'),
  interval: () => text('间隔'), once: () => text('单次'), weekly: () => text('每周'),
  biweekly: () => text('每双周'), monthly: () => text('每月'), yearly: () => text('每年'),
}

/** Resolve the label of one saved recurrence kind.
 * @param value - Saved recurrence kind.
 * @returns User-facing recurrence label.
 */
export function cadenceLabel(value: AutomationTask['cadence']): string { return labels[value]() }

/** Format a local calendar date without a UTC timezone conversion.
 * @param date - Local calendar date.
 * @returns YYYY-MM-DD without converting through UTC.
 */
export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
