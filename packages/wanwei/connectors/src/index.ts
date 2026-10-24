/**
 * Host half: DingTalk DWS skill + `dingtalk_dws` tool + WeChat Assistant iLink channel.
 */
import type { Context } from '@deepseek-ai/cordis'
import { registerDingTalkDwsRpc, resolveDwsCommand } from './dingtalk-dws.ts'
import { registerDingTalkDwsTool } from './dingtalk-dws-tool.ts'
import { registerWeChatIlinkRpc } from './wechat-ilink.ts'
import { registerFeishu } from './feishu-cli.ts'
import { registerAutomationConnectors } from './automation-bridge.ts'

/** Cordis plugin name. */
export const name = 'wanwei-connectors'
/**
 * Connection carries RPC; tools carries `dingtalk_dws`; session services power
 * the WeChat inbound bridge; DSH_HOME is read from the process environment.
 */
export const inject = [
  'connection',
  'tools',
  'sessionController',
  'sessions',
  'agents',
  'workspaceRegistry',
  'permissionPresets',
]

/**
 * Mount DingTalk and WeChat Assistant connector RPC for the connectors page,
 * plus the `dingtalk_dws` tool for desktop chat.
 * @param ctx - Host context with connection, tool, and session services.
 * @returns nothing.
 */
export function apply(ctx: Context): void {
  registerDingTalkDwsRpc(ctx)
  registerDingTalkDwsTool(ctx, () => resolveDwsCommand())
  registerWeChatIlinkRpc(ctx)
  registerFeishu(ctx)
  registerAutomationConnectors(ctx)
}
