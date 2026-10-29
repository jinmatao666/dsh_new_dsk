import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'

/** Return the session's helper-script directory inside its selected workspace. */
export function sessionScriptDirectory(agent: Agent): string | undefined {
  const cwd = agent.session.header.cwd
  if (cwd === undefined || !isAbsolute(cwd)) return undefined
  const sessionId = String(agent.session.id).replace(/[^A-Za-z0-9._-]/g, '_')
  return join(cwd, '.dsh-work', sessionId, 'scripts')
}

/** Attach workspace-specific file placement instructions to each desktop agent. */
export function installScriptWorkspaceGuidance(ctx: Context): void {
  ctx.inject(['agents'], (child) => {
    const fibers = new Map<Agent, ReturnType<Context['inject']>>()
    const install = (agent: Agent): void => {
      if (fibers.has(agent)) return
      const directory = sessionScriptDirectory(agent)
      if (directory === undefined) return
      const fiber = agent.ctx.inject(['systemPrompt'], (promptCtx) => {
        promptCtx.systemPrompt.section({
          name: 'wanwei:script-workspace',
          order: FIRST_PARTY_SECTION_ORDER.DELIVERABLE_FILE_REFERENCES + 10,
          text: `本会话在工作区中生成的辅助脚本、提取与转换代码及其他中间处理文件，统一放在 ${JSON.stringify(directory)}。首次需要时创建该目录，执行脚本时使用此目录中的实际路径。用户要求的正文、报告和其他最终交付文件默认放在工作区根目录；用户明确指定其他输出位置时遵照指定。输入资料留在原位置，不要搬动或重命名用户已有文件。除非用户明确要求交付脚本，否则不要把辅助脚本加入 deliver_files。`,
        })
      })
      fibers.set(agent, fiber)
    }
    const dispose = (agent: Agent): void => {
      const fiber = fibers.get(agent)
      if (fiber === undefined) return
      fibers.delete(agent)
      void fiber.dispose().catch((error: unknown) => { child.logger.warn(`script-workspace prompt cleanup failed: ${String(error)}`) })
    }
    for (const agent of child.agents.list()) install(agent)
    child.on('agent/created', ({ agent }) => { install(agent) })
    child.on('agent/disposed', ({ agent }) => { dispose(agent) })
    child.effect(() => async () => {
      const pending = [...fibers.values()].map(fiber => fiber.dispose())
      fibers.clear()
      await Promise.all(pending)
    })
  })
}
