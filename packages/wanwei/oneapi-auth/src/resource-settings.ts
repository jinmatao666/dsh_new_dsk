/** Public resource configuration shared by the Host and Client. Contains no credentials. */
export interface ResourceSettings {
  transport?: 'forward' | 'tunnel'
  bypassHosts?: string[]
  source: 'offline' | 'proxy'
  proxyUrl: string
  autoDetect: boolean
  probeUrls: string[]
}

function validBypassHost(host: unknown): host is string {
  if (typeof host !== 'string' || !/^[a-z0-9.:-]{1,253}$/iu.test(host)) return false
  if (!host.includes(':')) return true
  try { return new URL(`http://[${host}]`).hostname !== '' } catch { return false }
}

/** Validate the public resource settings; omission retains legacy behavior.
 * @param value - Untrusted server field.
 * @returns Allowlisted settings, or undefined for an older server.
 */
export function resolveResourceSettings(value: unknown): ResourceSettings | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) throw new Error('后台资源配置无效')
  const data = value as Record<string, unknown>
  if (data.bypassHosts !== undefined && (!Array.isArray(data.bypassHosts) || data.bypassHosts.length > 32
    || data.bypassHosts.some((host: unknown) => !validBypassHost(host)))) {
    throw new Error('直连主机最多32个，只填写域名或IP，不含协议、路径和端口')
  }
  if (data.transport !== undefined && data.transport !== 'forward' && data.transport !== 'tunnel') {
    throw new Error('中转接入方式无效')
  }
  if ((data.source !== 'offline' && data.source !== 'proxy') || typeof data.proxyUrl !== 'string'
    || typeof data.autoDetect !== 'boolean' || !Array.isArray(data.probeUrls) || data.probeUrls.length > 4) {
    throw new Error('后台资源配置字段无效')
  }
  if (data.proxyUrl) {
    const url = new URL(data.proxyUrl)
    if ((url.protocol !== 'http:' && !(data.transport === 'tunnel' && url.protocol === 'https:'))
      || !url.hostname || url.username || url.password || url.search || url.hash
      || url.pathname !== '/') throw new Error('中转地址必须为不含账号和路径的 HTTP 代理地址')
  }
  if (data.source === 'proxy' && ((!data.proxyUrl && data.transport !== 'tunnel') || (data.autoDetect && data.probeUrls.length < 2))) {
    throw new Error('中转地址或自动检测地址缺失')
  }
  const probeUrls = data.probeUrls.map((raw: unknown) => {
    if (typeof raw !== 'string' || raw.length > 1024) throw new Error('检测地址无效')
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('检测地址必须为 HTTPS')
    return raw
  })
  return { source: data.source, proxyUrl: data.proxyUrl, autoDetect: data.autoDetect, probeUrls,
    ...(data.transport === undefined ? {} : { transport: data.transport }),
    ...(data.bypassHosts === undefined ? {} : { bypassHosts: data.bypassHosts as string[] }) }
}
