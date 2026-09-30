import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as chinese from '../src/index.ts'

describe('Chinese conversation policy', () => {
  it('preserves persona and tools, adds a language section, and removes it on unload', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: 'Expert instructions remain intact.' })
    const before = renderPrompt(await ctx.systemPrompt.assemble())
    const fiber = await ctx.plugin(chinese)
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(section => section.name === 'wanwei:conversation-language')?.text)
      .toMatchInlineSnapshot(`
        "默认使用简体中文与用户沟通，包括回答、计划、进度更新、总结和工具调用的简短说明。
        用户明确要求其他语言、翻译或保留原文时，遵循用户要求。
        代码、命令、文件路径、URL、配置键、变量名、工具和 API 标识保持原样；引用和原始工具结果不要改写。
        工具参数中的自然语言说明、任务标题及待办内容使用简体中文，但不要翻译机器标识或执行内容。"
      `)
    expect(renderPrompt(assembly)).toContain('Expert instructions remain intact.')
    expect(assembly.tools).toEqual([])
    await fiber.dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe(before)
  })

  it('respects complete personas', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.section({ name: 'complete-expert', order: 0, text: 'Complete expert.', complete: true })
    await ctx.plugin(chinese)
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('Complete expert.')
  })
})
