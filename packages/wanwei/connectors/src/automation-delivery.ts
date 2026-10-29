/** Deterministic delivery of automation results, independent of model tools. */
import { createHash } from 'node:crypto'
import { runLark } from './feishu-cli.ts'
import { resolveDwsCommand, resolveProductDshHome } from './dingtalk-dws.ts'
import { runDwsTool } from './dingtalk-dws-tool.ts'
import { sendWeChatNotification } from './wechat-ilink.ts'

interface CliBody {
  ok?: boolean
  success?: boolean
  error?: unknown
  data?: CliBody
  result?: CliBody | CliBody[]
  identities?: { user?: { available?: boolean; openId?: string } }
  userId?: string
  user_id?: string
}

/** Reject CLI business failures even when the process exited successfully.
 * @param result - CLI response.
 * @returns Validated JSON object.
 */
export function notificationResult(result: { exitCode: number | null; stdout: string; stderr: string }): CliBody {
  if (result.exitCode !== 0) throw new Error('连接器发送失败，请检查授权后重试')
  const raw: unknown = JSON.parse(result.stdout)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('连接器响应格式无效')
  const body = raw as CliBody
  if (body.ok === false || body.success === false || body.error) {
    throw new Error('连接器未确认发送成功，请重新连接后重试')
  }
  return body
}

/** Send only to the connector's current owner, using native argv without a shell.
 * @param channel - Saved opt-in channel.
 * @param text - Final result or execution status.
 * @param key - Stable run identifier for idempotent CLI sends.
 * @param signal - Owner's bounded operation lifetime.
 */
export async function deliverAutomationNotification(channel: string, text: string, key: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const timeout = AbortSignal.any([signal, AbortSignal.timeout(60000)])
  let recipient = ''
  const dws = channel === 'dingtalk' ? resolveDwsCommand() : undefined
  if (channel === 'feishu') {
    const auth = notificationResult(await runLark(['auth', 'status', '--json'], timeout))
    const user = (auth.data ?? auth).identities?.user
    if (user?.available !== true || typeof user.openId !== 'string' || !/^ou_[\w-]+$/.test(user.openId)) throw new Error('请重新连接飞书')
    recipient = user.openId
  } else if (channel === 'dingtalk') {
    if (!dws || /\.(cmd|bat|ps1)$/i.test(dws)) throw new Error('请安装桌面端原生钉钉连接器')
    const self = notificationResult(await runDwsTool(dws, ['contact', 'user', 'get-self', '--format', 'json'], undefined, timeout))
    const data = self.result ?? self.data ?? self
    const person = Array.isArray(data) ? (data.length === 1 ? data[0] : undefined) : data
    const selfId = person?.userId ?? person?.user_id
    if (typeof selfId !== 'string' || !selfId) throw new Error('无法确认钉钉本人账号，请重新连接')
    recipient = selfId
  } else if (channel !== 'wechat') throw new Error('不支持的推送渠道')
  // Bound every complete message, preserving all content across ordered parts.
  const points = Array.from(text)
  for (let offset = 0; offset < points.length; offset += 2500) {
    timeout.throwIfAborted()
    const part = `[自动化结果 ${Math.floor(offset / 2500) + 1}/${Math.ceil(points.length / 2500)}]\n` + points.slice(offset, offset + 2500).join('')
    const token = createHash('sha256').update(`${key}:${offset}`).digest('hex').slice(0, 48)
    if (channel === 'feishu') {
      const result = notificationResult(await runLark(['im', '+messages-send', '--as', 'bot', '--user-id', recipient,
        '--msg-type', 'text', '--content', JSON.stringify({ text: part }), '--idempotency-key', token, '--json'], timeout))
      if (result.ok !== true) throw new Error('飞书未确认发送成功')
    } else if (channel === 'dingtalk' && dws) {
      const response = notificationResult(await runDwsTool(dws, ['chat', '+messages-send', '--as', 'user', '--user', recipient,
        '--text', part, '--idempotency-key', token, '--yes', '--format', 'json'], undefined, timeout))
      if (response.success !== true && response.ok !== true) throw new Error('钉钉未确认发送成功')
    } else await sendWeChatNotification(resolveProductDshHome(), part)
  }
}
