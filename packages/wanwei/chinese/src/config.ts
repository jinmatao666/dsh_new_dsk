/** Chinese conversation plugin configuration and model-visible language policy. */
import z from '@deepseek-ai/schemastery'

/** Optional deployment controls; disabling removes both faces' contributions. */
export interface Config {
  instruction: string
}

/** Defaults for the independent plugin, not for the official application. */
export const Config: z<Config> = z.object({
  instruction: z.string().default([
    '默认使用简体中文与用户沟通，包括回答、计划、进度更新、总结和工具调用的简短说明。',
    '用户明确要求其他语言、翻译或保留原文时，遵循用户要求。',
    '代码、命令、文件路径、URL、配置键、变量名、工具和 API 标识保持原样；引用和原始工具结果不要改写。',
    '工具参数中的自然语言说明、任务标题及待办内容使用简体中文，但不要翻译机器标识或执行内容。',
  ].join('\n')),
})
