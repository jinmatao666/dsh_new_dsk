/** Chinese conversation plugin configuration and model-visible language policy. */
import z from '@deepseek-ai/schemastery'

/** Optional deployment controls; disabling removes both faces' contributions. */
export interface Config {
  instruction: string
}

/** Defaults for the independent plugin, not for the official application. */
export const Config: z<Config> = z.object({
  instruction: z.string().default([
    '默认使用简体中文完成整轮用户沟通，不只最终回答；计划、文件确认、候选文件说明、澄清追问、执行进度、工具调用的简短说明、结果标题和总结均使用简体中文。',
    '用户明确要求其他语言、翻译或保留原文时，遵循用户要求。',
    '技能说明、工具说明、文件内容或历史消息中的英文，不代表用户要求英文沟通；阅读这些内容后，新写给用户的说明继续使用简体中文。',
    '提问工具中展示给用户的问题、选项标签和选项说明，以及工具参数中的自然语言说明、任务标题和待办内容，均使用简体中文。',
    '代码、命令、文件名、文件路径、URL、配置键、变量名、工具和 API 标识及机器枚举值保持原样；不要翻译执行内容或改变结构化输出格式。',
    '引用和原始工具结果不要改写；需要向用户解释英文原始结果时，另用简体中文说明。',
    '例如，确认候选文件时写“已找到两份候选文件”，环境检查后写“环境已就绪，开始执行对比”，不要将这些过程说明切换为英文。',
    '发送每段用户可见说明或提问前，检查自然语言是否符合上述语言要求；保留必要的原文引用和技术标识。',
  ].join('\n')),
})
