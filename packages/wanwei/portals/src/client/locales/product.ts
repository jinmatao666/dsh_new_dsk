/** Product copy owned by this feature. */
const zh = {
  '土地市场': '土地市场',
  '资规讲坛': '资规讲坛',
  '政策宝典': '政策宝典',
  '浏览配置的土地市场页面': '浏览配置的土地市场页面',
  '浏览配置的资规讲坛页面': '浏览配置的资规讲坛页面',
  '浏览配置的政策宝典页面': '浏览配置的政策宝典页面',
  '请先在管理工作台配置页面地址': '请先在管理工作台配置页面地址',
  '管理员尚未配置此功能的页面地址，配置后即可在此查看。': '管理员尚未配置此功能的页面地址，配置后即可在此查看。',
  '正在加载…': '正在加载…',
  '正在分析，请稍候': '正在分析，请稍候',
  '桌面端当前模型不可用': '桌面端当前模型不可用',
  '无法连接桌面分析服务，请稍后重试': '无法连接桌面分析服务，请稍后重试',
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
