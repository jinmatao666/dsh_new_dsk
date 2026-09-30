/** Wanwei-owned SkillHub catalog and archive RPC. No OneAPI or agent-loop dependency. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-wanwei-oneapi-auth'
import { SkillHubApi, type ApiConfig } from './api.ts'

/** All upstream deployment choices are configured by the product bundle. */
export type Config = ApiConfig
/** Validate deployment limits before accepting calls. */
export const Config: z<Config> = z.object({
  baseURL: z.string().required(), timeoutMs: z.natural().min(1).required(),
  maxJsonBytes: z.natural().min(1).required(), maxArchiveBytes: z.natural().min(1).required(),
  downloadHosts: z.array(z.string()).required(),
})
export const name = 'wanwei-skillhub'
export const inject = ['connection', 'wanweiNetworkPolicy']

/** Register reversible RPC handlers using the existing authenticated Host connection. */
export function apply(ctx: Context, config: Config): void {
  const api = new SkillHubApi(config)
  const connection = ctx.get('connection') as HostConnectionHandle
  ctx.effect(() => connection.rpc.handle('/wanwei-skillhub', async (endpoint, payload, signal) => {
    try {
      if (ctx.wanweiNetworkPolicy.getSnapshot().mode === 'intranet') throw new Error('纯内网环境不可用')
      const value = endpoint === 'list' ? await api.list(payload, signal)
        : endpoint === 'categories' ? await api.categories(signal)
          : endpoint === 'detail' ? await api.detail(payload, signal)
            : endpoint === 'icon' ? await api.icon(payload, signal)
              : endpoint === 'download' ? await api.download(payload, signal)
                : undefined
      if (value === undefined) throw new Error('未知 SkillHub 操作')
      return { ok: true as const, value }
    } catch (error) {
      return { ok: false as const, error: { code: 'internal', message: error instanceof Error ? error.message : String(error), details: {} } }
    }
  }), 'wanwei-skillhub: RPC')
}
