import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session'

type Model = { id: string; name: string }

/** Report only model identifiers and display names from desktop-owned routes. */
export function trackCustomModels(
  ctx: Context, base: string, managed: string, settings: () => unknown, token: () => Promise<string | undefined>,
): void {
  const catalog = () => {
    const value = settings() as { providers?: Record<string, { models?: { id?: unknown; name?: unknown }[] }> } | undefined
    if (!value) return undefined
    const routes = new Map<string, Model[]>()
    for (const [provider, entry] of Object.entries(value.providers ?? {})) {
      if (provider === managed || provider === 'deepseek-official' || !Array.isArray(entry?.models)) continue
      routes.set(provider, entry.models.flatMap(m => typeof m?.id === 'string' && m.id.length > 0 && m.id.length <= 256
        ? [{ id: m.id, name: typeof m.name === 'string' ? m.name.slice(0, 256) : m.id }] : []))
    }
    return routes
  }
  const report = async (key: string, event: string, data: object) => {
    const response = await fetch(base + '/api/client-event', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ platform: 'desktop', events: [{ event, data }] }),
    })
    return response.ok && (await response.json() as { success?: boolean }).success === true
  }
  let last = '', owner: string | undefined, pending = false, disposed = false
  const sync = async () => {
    if (pending || disposed) return
    pending = true
    try {
      const key = await token()
      if (key !== owner) { owner = key; last = '' }
      const routes = catalog()
      if (!key || !routes || disposed) return
      const models = [...new Map([...routes.values()].flat().map(m => [m.id, m])).values()].slice(0, 200)
      const next = JSON.stringify(models)
      if (next !== last && await report(key, 'dsh_custom_model_catalog', { models })) last = next
    } catch { /* Retry snapshot on the next poll. */ }
    finally { pending = false }
  }
  ctx.effect(() => {
    const timer = setInterval(() => { void sync() }, 5000)
    return () => { disposed = true; clearInterval(timer) }
  })
  ctx.on('session/event', (_session, event) => {
    if (event.type !== 'assistant/message') return
    const { provider, model } = event.data.message.source
    const entry = catalog()?.get(provider)?.find(m => m.id === model)
    if (entry) void token().then(key => key && !disposed ? report(key, 'dsh_custom_model_call', entry) : undefined).catch(() => {})
  })
  void sync()
}
