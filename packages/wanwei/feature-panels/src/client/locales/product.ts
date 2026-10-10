/** Product copy owned by this feature. */
const zh = {
  '纯内网环境不可用': '纯内网环境不可用',
  '不可用': '不可用',
  'WANWEI Buddy': 'WANWEI Buddy',
  '返回': '返回',
  '关闭提示': '关闭提示',
} as const

/**
 * Resolve product copy and substitute its numbered values.
 * @param key - Source-message key owned by this dictionary.
 * @param values - Runtime values inserted without changing the surrounding copy.
 * @returns Localized message.
 */
export function productText(key: keyof typeof zh, values: readonly unknown[] = []): string {
  return zh[key].replace(/\{(\d+)\}/g, (_, index: string) => String(values[Number(index)]))
}
