/** Local scheduler and authenticated desktop RPC; never a cloud scheduler. */
import type { Context } from '@deepseek-ai/cordis'
import schema from '@deepseek-ai/schemastery'
import { apply as installRuntime } from './runtime.ts'

/** Deployment limits and local storage location. */
export interface Config {
  /** Local task document; defaults to automations.json in the Harness home. */
  dataFile?: string
  /** Credential reference identifying the authenticated account's model token. */
  credentialRef: string
  /** Scheduler polling interval in milliseconds. */
  tickMs: number
  /** Maximum due-slot lateness before skipping, in milliseconds. */
  lateToleranceMs: number
  /** Execution timeout, including approval waits, in milliseconds; defaults to one hour. */
  runTimeoutMs: number
  /** Optional document parser override; otherwise uses the desktop's DSH_DOCUMENT_TOOL. */
  documentTool?: string
  /** Per-file format parser timeout, in milliseconds. */
  outputCheckTimeoutMs: number
  /** Maximum saved tasks per account. */
  maxTasks: number
  /** Maximum retained completed execution records. */
  maxRecords: number
}
/** Deployment tunables validated by the Loader. */
export const Config: schema<Config> = schema.object({
  dataFile: schema.string(), credentialRef: schema.string().default('DSH_ONEAPI_TOKEN'),
  tickMs: schema.natural().min(250).default(1000), lateToleranceMs: schema.natural().min(1000).default(60000),
  runTimeoutMs: schema.natural().min(1000).default(3600000),
  documentTool: schema.string(), outputCheckTimeoutMs: schema.natural().min(1000).default(60000),
  maxTasks: schema.natural().min(1).default(100), maxRecords: schema.natural().min(1).default(500),
})
/** Host services; no Agent-loop changes. */
export const inject = ['connection', 'credentials', 'sessionController', 'sessions', 'agents',
  'permissionPresets', 'tools', 'workspaceRegistry', 'wanweiConnectors']
/** Stable plugin identity. */
export const name = 'wanwei-automations'
/** Install persistent CRUD and local scheduling.
 * @param ctx - Host context owning the plugin lifecycle.
 * @param config - Validated deployment configuration.
 * @returns Resolves when task storage and RPC registration are ready.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await installRuntime(ctx, config)
}
