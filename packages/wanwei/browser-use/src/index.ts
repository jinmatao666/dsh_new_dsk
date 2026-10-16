/** Official browser provider integration without changing the legacy Agent lifecycle. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import BrowserUse from '@deepseek-ai/dsh-browser-use'
import * as OfficialProvider from '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { FIRST_PARTY_SECTION_ORDER } from '@deepseek-ai/dsh-system-prompt'
import { BROWSER_GUIDANCE, BROWSER_UNAVAILABLE, browserStartupFailure, resolveBrowserExecutable } from './browser-executable.ts'
import type {} from '@deepseek-ai/dsh-wanwei-oneapi-auth'

/** Explicit desktop launch configuration; no automatic browser download or attachment. */
export interface Config {
  /** Enable browser tools and initialization for the desktop deployment. */
  enabled: boolean
  /** Launch the configured browser without a visible window. */
  headless: boolean
  /** Custom absolute browser path; omitted paths discover installed Chrome/Edge, without downloads. */
  executablePath?: string
}
/** Validate product-owned browser settings. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  headless: z.boolean().default(false),
  executablePath: z.string(),
})
/** Cordis plugin identity. */
export const name = 'wanwei-browser-use'
/** Existing runtime services needed by the official browser provider. */
export const inject = ['agents', 'tools', 'systemPrompt', 'settings']

interface Activation {
  controller: AbortController
  ready: Promise<void>
  settled: boolean
}
interface Created { agent: Agent; signal: AbortSignal }
type Initializer = (event: Created) => Promise<void>

/** Await initialization without letting a canceled model turn cancel its Session-owned browser. */
async function awaitReady(ready: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) return ready
  signal.throwIfAborted()
  await new Promise<void>((resolve, reject) => {
    const abort = () => { reject(signal.reason instanceof Error ? signal.reason : new Error('浏览器等待已取消')) }
    signal.addEventListener('abort', abort, { once: true })
    void ready.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
  })
  signal.throwIfAborted()
}

/**
 * Supply the two legacy lifecycle differences only to the official provider.
 * Its published implementation and the shared Agent registry remain unchanged.
 * @param ctx - the plugin's own reversible effect scope.
 * @param browserAllowed - current permission to initialize and expose browser tools.
 * @returns a provider-local Context facade.
 */
export function browserCompatibilityContext(ctx: Context, browserAllowed: () => boolean = () => true): Context {
  const activations = new Map<Agent, Activation>()
  let initialize: ((agent: Agent) => void) | undefined
  const workingDirectory = {
    async ensure(agent: Agent, signal: AbortSignal): Promise<string> {
      signal.throwIfAborted()
      const cwd = agent.session.header.cwd
      if (cwd === undefined || !isAbsolute(cwd)) throw new Error('浏览器需要有效的工作区目录')
      if (!(await stat(cwd)).isDirectory()) throw new Error('浏览器工作区路径不是目录')
      signal.throwIfAborted()
      return cwd
    },
  }
  ctx.on('system-prompt/assemble', async (_assembly, request, next) => {
    if (!browserAllowed()) return next()
    if (request.agent !== undefined && !activations.has(request.agent)) initialize?.(request.agent)
    const activation = request.agent === undefined ? undefined : activations.get(request.agent)
    if (activation !== undefined && !activation.settled) {
      await awaitReady(activation.ready, request.signal)
      // Assembly collected schemas before its waterfall; recollect after MCP registration.
      return ctx.systemPrompt.assemble(request)
    }
    if (activation !== undefined) await awaitReady(activation.ready, request.signal)
    return next()
  }, { prepend: true })
  ctx.effect(() => async () => {
    for (const activation of activations.values()) activation.controller.abort()
    await Promise.allSettled([...activations.values()].map(activation => activation.ready))
    activations.clear()
  })
  return new Proxy(ctx, {
    get(target, key): unknown {
      if (key === 'browserUse') return target.get('browserUse')
      if (key === 'get') return (service: string): unknown => service === 'workingDirectory'
        ? workingDirectory : target.get(service)
      if (key === 'on') return (event: string, listener: Initializer, options?: { prepend?: boolean }) => {
        if (event !== 'agent/created') return Reflect.apply(target.on.bind(target), target, [event, listener, options]) as unknown
        initialize = (agent: Agent) => {
          const controller = new AbortController()
          const ready = Promise.resolve().then(() => listener({ agent, signal: controller.signal }))
          const activation = { controller, ready, settled: false }
          activations.set(agent, activation)
          void ready.then(() => { activation.settled = true }, (error: unknown) => {
            activation.settled = true
            target.logger.warn(`浏览器初始化失败：${String(error)}`)
          })
          agent.ctx.effect(() => async () => {
            controller.abort()
            await ready.catch(() => {}) // Initialization failure is reported and remains visible to assembly.
            activations.delete(agent)
          })
        }
        return target.on('agent/created', ({ agent }) => {
          if (browserAllowed()) initialize?.(agent)
        }, options)
      }
      return Reflect.get(target, key, target) as unknown
    },
  })
}

/**
 * Mount the pinned official provider and deny browser tools in pure intranet mode.
 * @param ctx - desktop runtime services.
 * @param config - explicit launch settings.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const preference = ctx.settings.register(settingsNamespace('wanwei-browser-use'),
    z.object({ enabled: z.boolean().default(true) }), { base: { enabled: config.enabled } })
  await ctx.plugin(BrowserUse)
  const networkMode = (): string | undefined => {
    const policy = ctx.get('wanweiNetworkPolicy')
    return policy?.getSnapshot().mode
  }
  const administratorAllows = (): boolean =>
    ctx.get('wanweiNetworkPolicy')?.pluginAllowed('browserAssistant') ?? true
  const browserAllowed = (): boolean => administratorAllows() && preference.get().enabled && networkMode() !== 'intranet'
  const prefix = 'mcp__playwright-mcp__'
  const executablePath = await resolveBrowserExecutable(config.executablePath)
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'wanwei:browser-operation',
    order: FIRST_PARTY_SECTION_ORDER.DELIVERABLE_FILE_REFERENCES + 120,
    text: BROWSER_GUIDANCE,
  }))
  ctx.effect(() => ctx.tools.registerAvailability(tool =>
    !tool.startsWith(prefix) || browserAllowed()))
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name.startsWith(prefix) && !administratorAllows()) {
      return { kind: 'deny', reason: '管理员未允许使用浏览器助手，请联系管理员或刷新后台配置' }
    }
    if (exec.name.startsWith(prefix) && networkMode() === 'intranet') {
      return { kind: 'deny', reason: '纯内网环境暂不开放浏览器自动化' }
    }
    if (exec.name.startsWith(prefix) && !preference.get().enabled) {
      return { kind: 'deny', reason: '浏览器助手已停用，请在设置的插件配置中启用' }
    }
    if (exec.name.startsWith(prefix) && executablePath === undefined) {
      return { kind: 'deny', reason: BROWSER_UNAVAILABLE }
    }
    return next()
  }, { prepend: true })
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    if (!exec.name.startsWith(prefix) || decision.kind !== 'accept' || decision.value !== undefined) return decision
    const content = decision.content ?? result.content
    const text = content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (!browserStartupFailure(text)) return decision
    const additionalContexts = [...result.additionalContexts ?? [], ...decision.additionalContexts ?? []]
    return { kind: 'block', ...additionalContexts.length === 0 ? {} : { additionalContexts }, feedback: [
      { type: 'text', text: '浏览器启动失败，当前浏览器任务无法继续。请检查浏览器安装和可执行文件路径，处理后重启桌面端并新建对话。不要自动下载浏览器或用脚本绕过，请如实向用户说明失败原因。' },
      ...content,
    ] }
  })
  OfficialProvider.apply(browserCompatibilityContext(ctx, browserAllowed), {
    mode: 'launch', headless: config.headless,
    ...executablePath === undefined ? {} : { executablePath },
  })
}
