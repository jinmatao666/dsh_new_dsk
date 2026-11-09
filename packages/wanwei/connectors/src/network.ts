import type { Context } from '@deepseek-ai/cordis'

interface ConnectorNetworkPolicy {
  featureAllowed(feature: 'connectors'): boolean
  getSnapshot(): { mode: string; directInternet?: boolean }
  watch(listener: () => void): () => void
}

/** Read the deployment policy when the product mounts its authentication host. */
export function connectorNetworkPolicy(ctx: Context): ConnectorNetworkPolicy | undefined {
  return ctx.get?.('wanweiNetworkPolicy' as never) as ConnectorNetworkPolicy | undefined
}

/** Read the deployment permission before accessing a remote connector. */
export function connectorsAllowed(ctx: Context): boolean {
  const policy = connectorNetworkPolicy(ctx)
  return policy === undefined || (policy.featureAllowed('connectors')
    && (policy.getSnapshot().mode === 'internet' || policy.getSnapshot().directInternet === true))
}
