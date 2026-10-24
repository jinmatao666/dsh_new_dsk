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
}
/** UI operations owned by the Host connector. */
export interface FeishuApi { call(operation: 'status' | 'configure' | 'login' | 'disconnect'): Promise<FeishuStatus> }

/** Bind Feishu connector RPC with validated non-secret flags.
 * @param connection - Desktop Host transport.
 * @returns Connector operations.
 */
export function createFeishuApi(connection: ConnectionHandle): FeishuApi {
  return { async call(operation) {
    const value = rpcValue(await connection.rpc.call('/wanwei-feishu', operation, {})) as Partial<FeishuStatus> | null
    if (!value || typeof value.installed !== 'boolean' || typeof value.authed !== 'boolean'
      || typeof value.authorizing !== 'boolean') throw new Error(text('状态加载失败'))
    return { installed: value.installed, authed: value.authed, authorizing: value.authorizing,
      authorizationUrl: typeof value.authorizationUrl === 'string' ? value.authorizationUrl : null,
      qrDataUrl: typeof value.qrDataUrl === 'string' ? value.qrDataUrl : null,
      error: typeof value.error === 'string' ? value.error : null }
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
      try { const value = await api.call('status'); if (!disposed) { setStatus(value); onStatus(value) } }
      catch (failure) { if (!disposed) setError(String(failure)) }
      finally { pending = false }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 1500)
    return () => { disposed = true; clearInterval(timer) }
  }, [api])
  const operate = async (operation: 'configure' | 'login' | 'disconnect') => {
    setBusy(true); setError('')
    try { const value = await api.call(operation); setStatus(value); onStatus(value) }
    catch (failure) { setError(String(failure)) }
    finally { setBusy(false) }
  }
  return <div className="dsh-connector-dingtalk">
    <p className="dsh-connector-dingtalk-desc">{text('连接飞书后，可在对话和自动化中使用消息、文档、日历与待办。')}</p>
    <p className="dsh-connector-dingtalk-hint">{text('首次使用先配置飞书应用，再完成个人授权。仅在授权范围内访问。')}</p>
    {!status?.installed && status && <p role="alert" className="dsh-connector-dingtalk-error">{text('未找到随包飞书 CLI，请使用完整安装包')}</p>}
    {(error || status?.error) && <p role="alert" className="dsh-connector-dingtalk-error">{error || status?.error}</p>}
    {status?.authorizing && <p role="status" className="dsh-connector-dingtalk-hint">{text('请在飞书完成授权，完成后此页面自动更新')}</p>}
    {status?.authorizationUrl && <div className="dsh-connector-feishu-auth">
      <a href={status.authorizationUrl} target="_blank" rel="noreferrer">{text('打开飞书授权页面')}</a>
      {status.qrDataUrl && <img src={status.qrDataUrl} alt={text('飞书授权二维码')} width={200} height={200} />}
    </div>}
    <div className="dsh-connector-dingtalk-actions">
      <button type="button" className="secondary" disabled={busy || !status?.installed || status.authorizing || status.authed}
        onClick={() => { void operate('configure') }}>{text('配置飞书应用')}</button>
      <button type="button" disabled={busy || !status?.installed || status.authorizing}
        onClick={() => { void operate(status?.authed ? 'disconnect' : 'login') }}>{status?.authed ? text('解绑') : text('连接')}</button>
    </div>
    <div className="dsh-connector-dingtalk-examples"><h3>{text('试试这样用')}</h3>
      <button type="button" className="dsh-connector-dingtalk-example" disabled={!status?.authed}
        onClick={() => { onTry(text('查看我今天的飞书日程，按时间列出会议和待办')) }}>{text('查看我今天的飞书日程，按时间列出会议和待办')}</button>
    </div>
  </div>
}
