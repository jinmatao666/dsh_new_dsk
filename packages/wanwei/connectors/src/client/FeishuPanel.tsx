/** Official CLI authorization UI; no app secret or device code enters the WebView. */
import { useEffect, useState } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { rpcValue } from './dingtalk-api.ts'
import { productText as text } from './locales/product.ts'

/** Public Feishu authorization state. */
export interface FeishuStatus {
  installed: boolean
  authed: boolean
  authorizing: boolean
  authorizationUrl: string | null
  qrDataUrl: string | null
  error: string | null
  missingScopes: string[]
  authorizationStage: 'configure' | 'login' | null
  bridge: { enabled: boolean; state: 'stopped' | 'connecting' | 'ready' | 'error'; error: string | null }
}
/** UI operations owned by the Host connector. */
export interface FeishuApi { call(operation: 'status' | 'configure' | 'login' | 'authorize-messages' | 'bridge-enable' | 'bridge-disable' | 'disconnect'): Promise<FeishuStatus> }

/** Business examples share the existing connector card presentation. */
export const FEISHU_EXAMPLE_PROMPTS = [
  '查看我今天的飞书日程，按时间列出会议和待办',
  '给飞书联系人张三发一条消息：明天下午 3 点开项目评审会，请提前准备材料',
  '在飞书云文档中查找【项目周报】，总结本周进展、风险和待办事项',
  '在飞书中创建一项待办：周五下午 5 点前整理项目评审材料',
] as const

/** Bind Feishu connector RPC with validated non-secret flags.
 * @param connection - Desktop Host transport.
 * @returns Connector operations.
 */
export function createFeishuApi(connection: ConnectionHandle): FeishuApi {
  return { async call(operation) {
    const value = rpcValue(await connection.rpc.call('/wanwei-feishu', operation, {})) as Partial<FeishuStatus> | null
    if (!value || typeof value.installed !== 'boolean' || typeof value.authed !== 'boolean'
      || typeof value.authorizing !== 'boolean') throw new Error(text('状态加载失败'))
    const bridge = value.bridge
    return { installed: value.installed, authed: value.authed, authorizing: value.authorizing,
      authorizationUrl: typeof value.authorizationUrl === 'string' ? value.authorizationUrl : null,
      qrDataUrl: typeof value.qrDataUrl === 'string' ? value.qrDataUrl : null,
      error: typeof value.error === 'string' ? value.error : null,
      missingScopes: Array.isArray(value.missingScopes) ? value.missingScopes.filter((scope): scope is string => typeof scope === 'string') : [],
      authorizationStage: value.authorizationStage === 'configure' || value.authorizationStage === 'login' ? value.authorizationStage : null,
      bridge: { enabled: bridge?.enabled === true,
        state: bridge && ['stopped', 'connecting', 'ready', 'error'].includes(bridge.state) ? bridge.state : 'stopped',
        error: typeof bridge?.error === 'string' ? bridge.error : null } }
  } }
}

/** Configure an app once, authorize a user and stage real Feishu requests.
 * @param props - Host API, status callback and conversation handoff.
 * @returns Feishu sheet content matching existing connector panels.
 */
export function FeishuPanel({ api, onStatus, onTry }: {
  api: FeishuApi
  onStatus: (status: FeishuStatus) => void
  onTry: (prompt: string) => void
}) {
  const [status, setStatus] = useState<FeishuStatus | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let disposed = false
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try { const value = await api.call('status'); if (!disposed) { setStatus(value); setError(''); onStatus(value) } }
      catch (failure) { if (!disposed) setError(String(failure)) }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 1500)
    return () => { disposed = true; clearInterval(timer) }
  }, [api])
  const operate = async (operation: 'configure' | 'login' | 'authorize-messages' | 'bridge-enable' | 'bridge-disable' | 'disconnect') => {
    setBusy(true); setError('')
    try { const value = await api.call(operation); setStatus(value); onStatus(value) }
    catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }
  const needsAuthorization = (status?.missingScopes.length ?? 0) > 0
  return <div className="dsh-connector-dingtalk dsh-connector-feishu">
    <div className="dsh-connector-dingtalk-brand" aria-hidden="true">
      <span className="dsh-connector-dingtalk-brand-wanwei">{text('WB')}</span>
      <span className="dsh-connector-dingtalk-brand-dots">···</span>
      <img src="/connector-icons/feishu.png" alt="" width={40} height={40} />
    </div>
    <p className="dsh-connector-dingtalk-desc">{text('连接飞书后，可在对话和自动化中使用消息、文档、日历与待办。')}</p>
    {!status?.installed && status && <p role="alert" className="dsh-connector-dingtalk-error">{text('未找到随包飞书 CLI，请使用完整安装包')}</p>}
    {(error || status?.error) && <p role="alert" className="dsh-connector-dingtalk-error">{error || status?.error}</p>}
    {status?.authorizing && <div className="dsh-connector-feishu-auth">
      <p role="status" className="dsh-connector-dingtalk-hint">{status.authorizationStage === 'configure' ? text('第 1 步：扫码创建飞书应用，完成后二维码将切换为个人授权。') : text('第 2 步：请扫描当前二维码完成个人授权，完成后此页面自动更新。')}</p>
      {status.qrDataUrl && <div className="dsh-connector-feishu-qr">
        <img src={status.qrDataUrl} alt={text('飞书授权二维码')} width={176} height={176} />
      </div>}
      {status.authorizationUrl && <a href={status.authorizationUrl} target="_blank" rel="noreferrer">{text('打开飞书授权页面')}</a>}
    </div>}
    {needsAuthorization && !status?.authorizing && <div className="dsh-connector-dingtalk-hint" role="status">
      <p>{text('飞书已登录，但当前操作缺少权限，请补充授权后再试。')}</p>
      <p title={status?.missingScopes.join('、')}>{status?.missingScopes.map(scope => scope === 'im:message.send_as_user'
        ? text('以你的身份发送飞书消息') : scope).join('、')}</p>
      <p>{text('若飞书提示需要管理员审批，请联系应用管理员开通对应权限。')}</p>
    </div>}
    <div className="dsh-connector-dingtalk-actions">
      {status?.authorizing ? <button type="button" disabled>{text('等待授权…')}</button>
        : status?.authed ? <>
          {needsAuthorization
            ? <button type="button" disabled={busy} onClick={() => { void operate('login') }}>{text('补充授权')}</button>
            : <button type="button" disabled={busy} onClick={() => { onTry(text(FEISHU_EXAMPLE_PROMPTS[0])) }}>{text('去试试')}</button>}
          {!needsAuthorization && <button type="button" className="secondary" disabled={busy} onClick={() => { void operate('authorize-messages') }}>{text('授权发送消息')}</button>}
          <button type="button" className="secondary" disabled={busy} onClick={() => { void operate('disconnect') }}>{text('解绑')}</button>
        </> : <button type="button" disabled={busy || !status?.installed}
          onClick={() => { void operate('login') }}>{text('连接')}</button>}
    </div>
    {status && !status.authed && <div className="dsh-connector-dingtalk-hint dsh-connector-feishu-setup">
      {text('首次连接将引导你配置飞书应用并完成个人授权。')}
      <button type="button" disabled={busy || !status.installed || status.authorizing}
        onClick={() => { void operate('configure') }}>{text('配置飞书应用')}</button>
    </div>}
    {status?.authed && <section className="dsh-connector-feishu-channel" aria-label={text('双向任务')}>
      <h3>{text('双向任务')}</h3>
      <p>{text('给当前飞书应用机器人发送文字指令，桌面执行后会回复原消息。仅接收当前授权账号的单聊指令。')}</p>
      <p>{text('首次使用需在飞书开放平台开启机器人能力，使用长连接订阅“接收消息”事件，并开通接收单聊与机器人发送消息权限。')}</p>
      <a href="https://open.feishu.cn/app" target="_blank" rel="noreferrer">{text('打开飞书应用管理')}</a>
      <p role="status">{status.bridge.state === 'ready' ? text('正在接收飞书指令')
        : status.bridge.state === 'connecting' ? text('正在连接飞书消息通道…')
          : status.bridge.enabled ? text('飞书消息通道未连接') : text('双向任务未开启')}</p>
      {status.bridge.error && <p role="alert" className="dsh-connector-dingtalk-error">{status.bridge.error}</p>}
      <div className="dsh-connector-dingtalk-actions">
        <button type="button" disabled={busy || status.authorizing || status.bridge.state === 'connecting'}
          onClick={() => { void operate('bridge-enable') }}>{status.bridge.enabled ? text('重新连接消息通道') : text('开启双向任务')}</button>
        {status.bridge.enabled && <button type="button" className="secondary" disabled={busy}
          onClick={() => { void operate('bridge-disable') }}>{text('关闭双向任务')}</button>}
      </div>
      <p>{text('电脑和桌面程序需要保持运行。任务会显示在桌面“飞书助理”工作区；需要确认的操作仍需在桌面处理。')}</p>
    </section>}
    <section className="dsh-connector-dingtalk-examples" aria-label={text('试试这样用')}>
      <h3>{text('试试这样用')}</h3>
      <ul>{FEISHU_EXAMPLE_PROMPTS.map(prompt => <li key={prompt}>
        <button type="button" className="dsh-connector-dingtalk-example" disabled={!status?.authed || busy || status.authorizing || needsAuthorization}
          onClick={() => { onTry(text(prompt)) }}><span>{text('“')}{text(prompt)}{text('”')}</span></button>
      </li>)}</ul>
    </section>
  </div>
}
