import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { FIRST_PARTY_SECTION_ORDER, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
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
        "默认使用简体中文完成整轮用户沟通，不只最终回答；计划、文件确认、候选文件说明、澄清追问、执行进度、工具调用的简短说明、结果标题和总结均使用简体中文。
        用户明确要求其他语言、翻译或保留原文时，遵循用户要求。
        技能说明、工具说明、文件内容或历史消息中的英文，不代表用户要求英文沟通；阅读这些内容后，新写给用户的说明继续使用简体中文。
        提问工具中展示给用户的问题、选项标签和选项说明，以及工具参数中的自然语言说明、任务标题和待办内容，均使用简体中文。
        代码、命令、文件名、文件路径、URL、配置键、变量名、工具和 API 标识及机器枚举值保持原样；不要翻译执行内容或改变结构化输出格式。
        引用和原始工具结果不要改写；需要向用户解释英文原始结果时，另用简体中文说明。
        例如，确认候选文件时写“已找到两份候选文件”，环境检查后写“环境已就绪，开始执行对比”，不要将这些过程说明切换为英文。
        发送每段用户可见说明或提问前，检查自然语言是否符合上述语言要求；保留必要的原文引用和技术标识。"
      `)
    expect(renderPrompt(assembly)).toContain('Expert instructions remain intact.')
    expect(assembly.tools).toEqual([])
    await fiber.dispose()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe(before)
  })

  it('places language guidance after English tool guidance and before structured output', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { persona: 'Expert instructions remain intact.' })
    ctx.systemPrompt.section({
      name: 'tool-guidance', order: FIRST_PARTY_SECTION_ORDER.DELIVERABLE_FILE_REFERENCES,
      text: 'Confirm candidate files. Report environment readiness.',
    })
    ctx.systemPrompt.section({
      name: 'output-schema', order: FIRST_PARTY_SECTION_ORDER.STRUCTURED_OUTPUT,
      text: 'Keep the required output schema.',
    })
    await ctx.plugin(chinese)
    const assembly = await ctx.systemPrompt.assemble()
    const names = assembly.sections.map(section => section.name)
    expect(names.indexOf('tool-guidance')).toBeLessThan(names.indexOf('wanwei:conversation-language'))
    expect(names.indexOf('wanwei:conversation-language')).toBeLessThan(names.indexOf('output-schema'))
    expect(renderPrompt(assembly)).toContain('Confirm candidate files. Report environment readiness.')
    expect(renderPrompt(assembly)).toContain('Keep the required output schema.')
  })

  it('retains an explicit deployment instruction instead of replacing it with defaults', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(chinese, { instruction: 'Follow the deployment language policy.' })
    expect((await ctx.systemPrompt.assemble()).sections
      .find(section => section.name === 'wanwei:conversation-language')?.text)
      .toBe('Follow the deployment language policy.')
  })

  it('respects complete personas', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    ctx.systemPrompt.section({ name: 'complete-expert', order: 0, text: 'Complete expert.', complete: true })
    await ctx.plugin(chinese)
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('Complete expert.')
  })
})
