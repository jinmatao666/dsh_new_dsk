/** Chinese product copy. Source-message keys preserve the current UI while translations are maintained here. */
const zh = {
  '分析结果': '分析结果',
  '正在加载分析成果…': '正在加载分析成果…',
  '分析成果未能在对话区加载': '分析成果未能在对话区加载',
  '打开 Excel': '打开 Excel',
  '打开 Word': '打开 Word',
  '分析视图未提供可展示的结果表。': '分析视图未提供可展示的结果表。',
  '{0}结果表格': '{0}结果表格',
  '空间分析成果': '空间分析成果',
  '分析数据分类': '分析数据分类',
  '加载更多（已显示': '加载更多（已显示',
  ' 条）': ' 条）',
  '正在导入文件…': '正在导入文件…',
  '已导入 {0} 个文件': '已导入 {0} 个文件',
  '文件导入失败：{0}': '文件导入失败：{0}',
  '导入文件': '导入文件',
  '松开鼠标，将文件导入当前工作区': '松开鼠标，将文件导入当前工作区',
  '万维 Buddy': '万维 Buddy',
  '专业智能助手': '专业智能助手',
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
