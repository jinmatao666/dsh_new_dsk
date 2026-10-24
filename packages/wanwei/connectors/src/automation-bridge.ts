/** Task-owned connector selection; scheduler consumes the Host service, not connector UI. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { buildDingTalkDwsStatus, resolveProductDshHome } from './dingtalk-dws.ts'
import { buildWeChatStatus, sendWeChatNotification } from './wechat-ilink.ts'
import { parseFeishuAuthenticated, resolveLarkCommand, runLark } from './feishu-cli.ts'

const entries = [
  { id: 'feishu', name: '飞书', icon: '/connector-icons/feishu.png', tool: 'feishu_cli' },
  { id: 'dingtalk', name: '钉钉', icon: '/connector-icons/dingtalk.png', tool: 'dingtalk_dws' },
  { id: 'wechat', name: '微信助理', icon: '/connector-icons/wechat.svg', tool: 'wechat_notify' },
] as const

/** Actual local authorization flags for the default connector picker. */
export interface ConnectorOption { id: string; name: string; icon: string; connected: boolean }
/** Host interface consumed independently of connector presentation. */
export interface AutomationConnectors {
  /** Read authorization flags; failed probes never imply authorization.
   * @param signal - Caller cancellation.
   * @returns Default connector entries.
   */
  options(signal: AbortSignal): Promise<ConnectorOption[]>
  /** Check selections and restrict connector tools for this agent's lifetime.
   * @param ids - Saved task selection; empty denies all connector tools.
   * @param agent - Task-owned fresh Session agent.
   * @param signal - Run cancellation.
   * @returns Instructions persisted in the ordinary user prompt.
   */
  prepare(ids: readonly string[], agent: Agent, signal: AbortSignal): Promise<string>
}
declare module '@deepseek-ai/cordis' { interface Context { wanweiConnectors: AutomationConnectors } }

/** Install scheduler access and bound-user WeChat delivery.
 * @param ctx - Connector plugin owning registrations.
 */
export function registerAutomationConnectors(ctx: Context): void {
  const service: AutomationConnectors = {
    async options(signal) {
      const home = resolveProductDshHome()
      return Promise.all(entries.map(async (entry) => {
        let connected = false
        try {
          if (entry.id === 'dingtalk') {
            const state = await buildDingTalkDwsStatus(home, { fresh: true })
            connected = state.authed && state.skillInstalled
          } else if (entry.id === 'wechat') connected = buildWeChatStatus(home, { fresh: true }).authed
          else connected = resolveLarkCommand() !== undefined
            && parseFeishuAuthenticated((await runLark(['auth', 'status', '--json'], signal)).stdout)
        } catch (error) {
          signal.throwIfAborted()
          ctx.logger.debug(`连接器 ${entry.id} 状态探测失败：${String(error)}`)
        }
        return { id: entry.id, name: entry.name, icon: entry.icon, connected }
      }))
    },
    async prepare(ids, agent, signal) {
      const unknown = ids.find(id => !entries.some(entry => entry.id === id))
      if (unknown) throw new Error(`不支持的连接器：${unknown}`)
      if (ids.length > 0) {
        const missing = (await service.options(signal)).filter(entry => ids.includes(entry.id) && !entry.connected)
        if (missing.length) throw new Error(`请先连接：${missing.map(entry => entry.name).join('、')}`)
      }
      const allowed = new Set<string>(entries.filter(entry => ids.includes(entry.id)).map(entry => entry.tool))
      const connectorTool = (name: string) => entries.some(entry => entry.tool === name)
      agent.ctx.effect(() => agent.ctx.tools.registerAvailability(name => !connectorTool(name) || allowed.has(name)))
      agent.ctx.on('tools/pre-execute', async (exec, next) => {
        if (connectorTool(exec.name) && !allowed.has(exec.name)) return { kind: 'deny', reason: '该连接器未被此自动化任务选中' }
        return next()
      })
      return ids.length === 0 ? '本任务未选择连接器，不要调用连接器工具。' :
        `本任务仅选择连接器：${entries.filter(entry => ids.includes(entry.id)).map(entry => entry.name).join('、')}。`
        + '飞书使用 feishu_cli，先查看 --help，并用 --as user 访问个人资源；钉钉使用 dingtalk_dws，先读取 dws-cli 技能。'
        + '微信仅可用 wechat_notify 向已绑定的本人会话发送任务明确要求的文字，不支持任意联系人、群聊或历史检索。'
        + '选择只开放能力，不代表要求推送；仅按任务指定的收件人和内容操作。授权过期或需要额外确认时报告 waiting，不自动登录、不绕过确认。'
    },
  }
  ctx.provide('wanweiConnectors', service)
  ctx.effect(() => ctx.connection.rpc.handle('/wanwei-connectors', async (operation, _payload, signal) => {
    try {
      if (operation !== 'options') throw new Error('未知连接器操作')
      return { ok: true as const, value: await service.options(signal) }
    } catch (error) { return { ok: false as const, error: { code: 'INTERNAL' as const,
      message: error instanceof Error ? error.message : String(error), details: {} } } }
  }))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'wechat_notify', description: 'Send explicitly requested text to the bound WeChat Assistant user only. '
      + 'Requires a prior inbound WeChat message; not for other contacts, groups or history. Selection alone never authorizes a send.',
    parameters: { text: { type: 'string', required: true } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      if (!args.text.trim() || args.text.length > 4000) throw new Error('微信通知需为 1–4000 字符')
      await sendWeChatNotification(resolveProductDshHome(), args.text)
      return '微信通知已发送至绑定会话'
    },
  })))
}
