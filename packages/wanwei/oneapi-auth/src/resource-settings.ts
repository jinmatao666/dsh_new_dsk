/** Public resource configuration shared by the Host and Client. Contains no credentials. */
export interface ResourceSettings {
  source: 'offline' | 'proxy'
  proxyUrl: string
  autoDetect: boolean
  probeUrls: string[]
}

/** Validate the public resource settings; omission retains legacy behavior.
 * @param value - Untrusted server field.
 * @returns Allowlisted settings, or undefined for an older server.
 */
export function resolveResourceSettings(value: unknown): ResourceSettings | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) throw new Error('后台资源配置无效')
  const data = value as Record<string, unknown>
  if ((data.source !== 'offline' && data.source !== 'proxy') || typeof data.proxyUrl !== 'string'
    || typeof data.autoDetect !== 'boolean' || !Array.isArray(data.probeUrls) || data.probeUrls.length > 4) {
    throw new Error('后台资源配置字段无效')
  }
  if (data.proxyUrl) {
    const url = new URL(data.proxyUrl)
    if (url.protocol !== 'http:' || !url.hostname || url.username || url.password || url.search || url.hash
      || url.pathname !== '/') throw new Error('中转地址必须为不含账号和路径的 HTTP 代理地址')
  }
  if (data.source === 'proxy' && (!data.proxyUrl || (data.autoDetect && data.probeUrls.length < 2))) {
    throw new Error('中转地址或自动检测地址缺失')
  }
  const probeUrls = data.probeUrls.map((raw: unknown) => {
    if (typeof raw !== 'string' || raw.length > 1024) throw new Error('检测地址无效')
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('检测地址必须为 HTTPS')
    return raw
  })
  return { source: data.source, proxyUrl: data.proxyUrl, autoDetect: data.autoDetect, probeUrls }
}
