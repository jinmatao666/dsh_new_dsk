/** Sidecar-only resource routing for newly spawned, proxy-aware shell clients. */
import type { NetworkEnvironment } from './network-contract.ts'
import { request } from 'node:https'
import type { ResourceSettings } from './resource-settings.ts'
import { ResourceTunnel } from './resource-tunnel.ts'

const proxyKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy',
  'NO_PROXY', 'no_proxy', 'PIP_PROXY', 'npm_config_proxy', 'npm_config_https_proxy', 'NPM_CONFIG_PROXY', 'NPM_CONFIG_HTTPS_PROXY']
const pipKeys = ['PIP_NO_INDEX', 'PIP_FIND_LINKS', 'PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL', 'PIP_CONFIG_FILE',
  'PIP_TRUSTED_HOST', 'PIP_RETRIES', 'PIP_TIMEOUT', 'PIP_DISABLE_PIP_VERSION_CHECK', 'npm_config_offline', 'NPM_CONFIG_OFFLINE']

async function probeDirect(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(url, { agent: false, signal: AbortSignal.timeout(2500), method: 'GET' }, (response) => {
      resolve(response.statusCode === 204)
      response.destroy()
    })
    req.on('error', () => { resolve(false) })
    req.end()
  })
}

/** Own only this sidecar's environment; disposal does not overwrite later external edits. */
export class ResourceRouting {
  private readonly original = new Map([...proxyKeys, ...pipKeys].map(key => [key, process.env[key]]))
  private readonly owned = new Map<string, string | undefined>()
  private settings: ResourceSettings | undefined
  private mode: NetworkEnvironment = 'internet'
  private revision = 0
  private checkedAt = 0
  private direct = false
  private pending: Promise<void> | undefined
  private readonly tunnel: ResourceTunnel
  private localProxy: string | undefined

  constructor(private readonly baseURL: string, private readonly probe: (url: string) => Promise<boolean> = probeDirect,
    resolveToken: () => Promise<string | undefined> = () => Promise.resolve(undefined)) {
    this.tunnel = new ResourceTunnel(async () => {
      if (this.mode !== 'intranet' || this.settings?.source !== 'proxy' || this.settings.transport !== 'tunnel' || this.direct) {
        throw new Error('Managed resource tunnel is not active')
      }
      const endpoint = new URL(this.settings.proxyUrl || this.baseURL)
      // A public administrator setting must not send login credentials to another origin.
      if (endpoint.origin !== new URL(this.baseURL).origin) throw new Error('中转入口须与登录后台同源')
      const token = await resolveToken()
      if (!token) throw new Error('请先登录后使用联网中转')
      return { baseURL: endpoint.origin, token }
    })
  }

  /** Commit a server configuration; later commands observe it without rewriting running children.
   * @param mode - Server-confirmed deployment mode.
   * @param settings - Validated resource selection.
   */
  configure(mode: NetworkEnvironment, settings: ResourceSettings | undefined): void {
    if (mode === this.mode && JSON.stringify(settings) === JSON.stringify(this.settings)) return
    this.mode = mode
    this.settings = settings
    this.tunnel.disconnect()
    this.checkedAt = 0
    this.direct = false
    this.revision++
    this.apply()
  }

  /** Prepare the environment before a shell tool spawns; direct probes run concurrently and are cached.
   * @returns Completion of the current route decision. Failed probes select the configured proxy.
   */
  async prepare(): Promise<void> {
    await this.detect()
    if (this.mode === 'intranet' && this.settings?.source === 'proxy' && this.settings.transport === 'tunnel' && !this.direct) {
      if (this.settings.proxyUrl && new URL(this.settings.proxyUrl).origin !== new URL(this.baseURL).origin) {
        throw new Error('中转入口须与登录后台同源')
      }
      this.localProxy = await this.tunnel.start()
      this.apply()
    }
  }

  private async detect(): Promise<void> {
    if (this.mode !== 'intranet' || this.settings?.source !== 'proxy' || !this.settings.autoDetect) return
    if (Date.now() - this.checkedAt < 60_000) return
    if (this.pending) { await this.pending; return this.detect() }
    const revision = this.revision
    const urls = this.settings.probeUrls
    this.pending = (async () => {
      const results = await Promise.all(urls.map(async (url) => {
        try {
          return await this.probe(url)
        } catch { return false }
      }))
      if (revision !== this.revision) return
      this.direct = results.every(Boolean)
      this.checkedAt = Date.now()
      this.apply()
    })()
    try { await this.pending } finally { this.pending = undefined }
    if (revision !== this.revision) await this.detect()
  }

  /** Check direct connectivity without starting a resource tunnel.
   * @returns True in internet mode or after an enabled intranet probe succeeds; relay reachability does not qualify.
   */
  async directAvailable(): Promise<boolean> {
    await this.detect()
    return this.mode === 'internet' || (this.settings?.source === 'proxy' && this.settings.autoDetect && this.direct)
  }

  /** Model guidance describes only the selected source, not task capability.
   * @returns Source-specific restrictions, or undefined when no explicit intranet source is configured.
   */
  guidance(): string | undefined {
    if (this.mode !== 'intranet' || !this.settings) return undefined
    return this.settings.source === 'offline'
      ? '当前为内网离线依赖包模式。优先复用已安装依赖；安装 Python 包使用 python -m pip install 包名，环境已配置后台 wheel 依赖库。不得换源、访问公网包 URL 或切换代理。库中缺包时如实报告并停止依赖该包的步骤；不要反复修复环境。此资源库仅包含 Python wheel，不提供其他联网资源。'
      : '当前为内网联网中转模式。优先复用已安装依赖；pip、Python requests 和遵循 HTTP(S)_PROXY 的下载工具已配置资源路由。不得读取离线依赖库、覆盖代理或擅自换源。自动检测只决定直连或中转，不保证每个网站可达。原生 PowerShell 下载、Node fetch、浏览器等不保证读取代理环境，不能声称所有联网已接通。失败时依据原始输出简短报告，不要盲目重试。'
  }

  private set(key: string, value: string | undefined): void {
    if (value === undefined) Reflect.deleteProperty(process.env, key)
    else process.env[key] = value
    this.owned.set(key, value)
  }

  private apply(): void {
    this.restore()
    if (this.mode !== 'intranet' || !this.settings) return
    for (const key of [...proxyKeys, ...pipKeys]) this.set(key, undefined)
    const offline = this.settings.source === 'offline'
    const proxy = offline ? 'http://127.0.0.1:9' : this.direct ? undefined
      : this.settings.transport === 'tunnel' ? this.localProxy ?? 'http://127.0.0.1:9' : this.settings.proxyUrl
    for (const key of proxyKeys.filter(key => !['NO_PROXY', 'no_proxy'].includes(key))) this.set(key, proxy)
    // pip's explicit proxy option bypasses requests' NO_PROXY resolution for the internal wheel index.
    if (offline) this.set('PIP_PROXY', undefined)
    const platform = new URL(this.baseURL)
    const bypass = ['localhost', '127.0.0.1', '::1', platform.hostname, ...this.settings.bypassHosts ?? []].join(',')
    this.set('NO_PROXY', bypass)
    this.set('no_proxy', bypass)
    // Ignore user/global pip indexes: mode switching cannot retain an extra index or a conflicting pip.ini.
    this.set('PIP_CONFIG_FILE', process.platform === 'win32' ? 'NUL' : '/dev/null')
    this.set('PIP_DISABLE_PIP_VERSION_CHECK', '1')
    this.set('PIP_RETRIES', '0')
    this.set('PIP_TIMEOUT', '10')
    if (offline) {
      this.set('PIP_NO_INDEX', '1')
      this.set('PIP_FIND_LINKS', `${this.baseURL}/api/desktop-resources/wheels/`)
      if (platform.protocol === 'http:') this.set('PIP_TRUSTED_HOST', platform.hostname)
      this.set('npm_config_offline', 'true')
    } else {
      this.set('PIP_INDEX_URL', 'https://pypi.org/simple')
    }
  }

  /** Restore only owned process variables; never changes system/user environment settings. */
  restore(): void {
    for (const [key, value] of this.owned) {
      if (process.env[key] !== value) continue
      const original = this.original.get(key)
      if (original === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = original
    }
    this.owned.clear()
  }

  /** Restore the owned environment and await local proxy teardown.
   * @returns Completion after the listener and active bridges are closed.
   */
  async dispose(): Promise<void> {
    this.restore()
    await this.tunnel.dispose()
  }
}
