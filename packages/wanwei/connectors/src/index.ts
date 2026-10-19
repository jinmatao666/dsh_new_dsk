/**
 * Host half: DingTalk DWS + WeCom wecom-cli skills + WeChat Assistant iLink channel.
 */
import type { Context } from '@deepseek-ai/cordis'
import { registerDingTalkDwsRpc } from './dingtalk-dws.ts'
import { registerWeComCliRpc } from './wecom-cli.ts'
import { registerWeChatIlinkRpc } from './wechat-ilink.ts'

/** Cordis plugin name. */
export const name = 'wanwei-connectors'
/**
 * Connection carries RPC; session services power the WeChat inbound bridge;
 * DSH_HOME is read from the process environment.
 */
export const inject = [
  'connection',
  'sessionController',
  'sessions',
  'agents',
  'workspaceRegistry',
  'permissionPresets',
]

/**
 * Mount DingTalk, WeCom, and WeChat Assistant connector RPC for the connectors page.
 * @param ctx - Host context with connection and session services.
 */
export function apply(ctx: Context): void {
  registerDingTalkDwsRpc(ctx)
  registerWeComCliRpc(ctx)
  registerWeChatIlinkRpc(ctx)
}
