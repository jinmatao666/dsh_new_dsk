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

/** Explicit desktop launch configuration; no automatic browser download or attachment. */
export interface Config {
  /** Enable browser tools and initialization for the desktop deployment. */
  enabled: boolean
  /** Launch the configured browser without a visible window. */
  headless: boolean
  /** Absolute path to an installed browser; no browser download is performed. */
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
    const policy = ctx.get('wanweiNetworkPolicy') as { getSnapshot(): { mode: string } } | undefined
    return policy?.getSnapshot().mode
  }
  const prefix = 'mcp__playwright-mcp__'
  ctx.effect(() => ctx.tools.registerAvailability(tool =>
    !tool.startsWith(prefix) || (preference.get().enabled && networkMode() !== 'intranet')))
  ctx.on('tools/pre-execute', async (exec, next) => {
    if (exec.name.startsWith(prefix) && networkMode() === 'intranet') {
      return { kind: 'deny', reason: '纯内网环境暂不开放浏览器自动化' }
    }
    if (exec.name.startsWith(prefix) && !preference.get().enabled) {
      return { kind: 'deny', reason: '浏览器助手已停用，请在设置的插件配置中启用' }
    }
    return next()
  }, { prepend: true })
  OfficialProvider.apply(browserCompatibilityContext(ctx,
    () => preference.get().enabled && networkMode() !== 'intranet'), {
    mode: 'launch', headless: config.headless,
    ...config.executablePath === undefined ? {} : { executablePath: config.executablePath },
  })
}
