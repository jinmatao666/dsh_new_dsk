/**
 * Desktop WeCom “connected” means wecom-cli auth + wecomcli-* skills under
 * `$DSH_HOME/skills`, so the Wanwei agent can run WeCom product commands in
 * desktop chat. The product ships `@wecom/cli` in the desktop runtime (WorkBuddy-
 * style); PATH / npm -g is only a fallback. Credentials stay in the CLI store.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { resolveProductDshHome } from './dingtalk-dws.ts'

const require = createRequire(import.meta.url)

/** How long a Host status snapshot may be reused without re-spawning `wecom-cli`. */
const STATUS_CACHE_TTL_MS = 45_000

/** GitHub archive used when the desktop runtime has not staged WeCom skills. */
const WECOM_CLI_SKILLS_TARBALL =
  'https://codeload.github.com/WecomTeam/wecom-cli/tar.gz/refs/heads/main'

/** Shared skill that every WeCom CLI skill depends on; used as the install gate. */
export const WECOM_SHARED_SKILL_ID = 'wecomcli-shared'

/** Relative skills root under the staged desktop runtime app. */
export const WECOM_BUNDLED_SKILLS_REL = join('assets', 'wecom-skills')

/** Non-secret wecom-cli + skill status for the connectors page. */
export type WeComCliStatus = {
  cliInstalled: boolean
  cliVersion: string | null
  authed: boolean
  skillInstalled: boolean
  /** Short hint when something blocks desktop skill use. */
  hint: string | null
  /** True while `wecom-cli auth init` is still running outside the WebView request. */
  authorizing: boolean
  /** Failure text from the latest background login, or null. */
  authorizeError: string | null
}

type RunResult = { code: number | null; stdout: string; stderr: string }

type StatusCacheEntry = { at: number; home: string; status: WeComCliStatus }

let statusCache: StatusCacheEntry | null = null
let statusInflight: Promise<WeComCliStatus> | null = null
let resolvedWecomCommand: string | undefined | null = null
let loginFlight: Promise<void> | null = null
let loginChild: ChildProcess | null = null
let loginEpoch = 0
let loginError: string | null = null

/** Drop the in-process status cache after login / disconnect / skill install. */
export function invalidateWeComCliStatusCache(): void {
  statusCache = null
  statusInflight = null
  resolvedWecomCommand = null
}

/**
 * User-scoped install root discovered by skill-filesystem (`$DSH_HOME/skills`).
 * @param dshHome - product DSH home.
 * @returns skills directory.
 */
export function wecomSkillsInstallRoot(dshHome: string): string {
  return join(dshHome, 'skills')
}

/**
 * Absolute path of the shared WeCom skill under the product home.
 * @param dshHome - product DSH home.
 * @returns shared skill directory.
 */
export function wecomSharedSkillDir(dshHome: string): string {
  return join(wecomSkillsInstallRoot(dshHome), WECOM_SHARED_SKILL_ID)
}

/**
 * Resolve the wecom-cli config directory (credentials store).
 * @param env - process environment; overridable in tests.
 * @returns absolute config directory.
 */
export function resolveWeComConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.WECOM_CLI_CONFIG_DIR?.trim()
  if (override) return override
  if (process.platform === 'win32') {
    const appData = env.APPDATA?.trim()
    if (appData) return join(appData, 'wecom')
  }
  const home = env.HOME?.trim() || env.USERPROFILE?.trim()
  if (!home) throw new Error('无法解析企业微信 CLI 配置目录（缺少 HOME / USERPROFILE）')
  return join(home, '.config', 'wecom')
}

function run(
  cmd: string,
  args: readonly string[],
  timeoutMs = 15_000,
  onChild?: (child: ChildProcess) => void,
): Promise<RunResult> {
  // npm `.cmd` shims need a shell on Windows; the native `wecom-cli.exe` does not.
  const shell = process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(cmd)
  return new Promise(resolve => {
    const child = spawn(cmd, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell,
      windowsHide: true,
      env: process.env,
    })
    onChild?.(child)
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout?.on('data', chunk => { stdout += String(chunk) })
    child.stderr?.on('data', chunk => { stderr += String(chunk) })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr })
    })
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

/**
 * Platform package name used by `@wecom/cli` optionalDependencies.
 * @returns scoped package id, or undefined when the OS/arch is unsupported.
 */
export function wecomPlatformPackageName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | undefined {
  const key = `${platform}-${arch}`
  const map: Record<string, string> = {
    'darwin-arm64': '@wecom/cli-darwin-arm64',
    'darwin-x64': '@wecom/cli-darwin-x64',
    'linux-arm64': '@wecom/cli-linux-arm64',
    'linux-x64': '@wecom/cli-linux-x64',
    'win32-x64': '@wecom/cli-win32-x64',
  }
  return map[key]
}

function wecomBinaryFileName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'wecom-cli.exe' : 'wecom-cli'
}

/**
 * Candidate `node_modules` roots that may contain the product-bundled `@wecom/cli-*`.
 * @param env - process environment.
 * @returns directories to probe.
 */
function wecomNodeModulesRoots(env: NodeJS.ProcessEnv): string[] {
  const roots: string[] = []
  const nodeBin = env.DSH_NODE_BINARY?.trim()
  if (nodeBin) {
    // Production: `runtime-<ver>/node[.exe]` beside `runtime-<ver>/app/node_modules`.
    roots.push(join(dirname(nodeBin), 'app', 'node_modules'))
  }
  const anchor = env.DSH_BUNDLE_ANCHORS?.trim()
  if (anchor) {
    // Development: Tauri sets this to `products/wanwei-desktop/package.json`.
    roots.push(join(dirname(anchor), 'node_modules'))
  }
  const cwd = process.cwd()
  roots.push(join(cwd, 'node_modules'))
  roots.push(join(cwd, 'products', 'wanwei-desktop', 'node_modules'))
  const home = env.DSH_HOME?.trim()
  if (home) {
    roots.push(join(home, '..', 'node_modules'))
  }
  return roots
}

/**
 * Resolve the product-bundled WeCom native binary (WorkBuddy-style; no npm -g).
 * @param env - process environment; overridable in tests.
 * @returns absolute binary path, or undefined when not staged.
 */
export function resolveBundledWeComCli(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env.DSH_WECOM_CLI?.trim()
  if (override && existsSync(override)) return override
  const pkg = wecomPlatformPackageName()
  if (pkg === undefined) return undefined
  const binaryName = wecomBinaryFileName()
  for (const root of wecomNodeModulesRoots(env)) {
    const candidate = join(root, ...pkg.split('/'), 'bin', binaryName)
    if (existsSync(candidate)) return candidate
  }
  try {
    const pkgJson = require.resolve(`${pkg}/package.json`)
    const candidate = join(dirname(pkgJson), 'bin', binaryName)
    if (existsSync(candidate)) return candidate
  } catch {
    // Expected when the desktop product has not installed @wecom/cli yet.
  }
  return undefined
}

/**
 * Locate staged WeCom skill directories shipped with the desktop runtime.
 * @param env - process environment; overridable in tests.
 * @returns absolute skills root containing `wecomcli-shared`, or undefined.
 */
export function resolveBundledWeComSkillsDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env.DSH_WECOM_SKILLS_DIR?.trim()
  if (override && existsSync(join(override, WECOM_SHARED_SKILL_ID, 'SKILL.md'))) {
    return override
  }
  const nodeBin = env.DSH_NODE_BINARY?.trim()
  if (nodeBin) {
    const staged = join(dirname(nodeBin), 'app', WECOM_BUNDLED_SKILLS_REL)
    if (existsSync(join(staged, WECOM_SHARED_SKILL_ID, 'SKILL.md'))) return staged
  }
  // Production sidecar `cwd` is `runtime-<ver>/app`.
  const appRoot = env.DSH_APP_ROOT?.trim() || process.cwd()
  const cwdStaged = join(appRoot, WECOM_BUNDLED_SKILLS_REL)
  if (existsSync(join(cwdStaged, WECOM_SHARED_SKILL_ID, 'SKILL.md'))) return cwdStaged
  const documentTool = env.DSH_DOCUMENT_TOOL?.trim()
  if (documentTool) {
    const staged = join(dirname(documentTool), WECOM_BUNDLED_SKILLS_REL)
    if (existsSync(join(staged, WECOM_SHARED_SKILL_ID, 'SKILL.md'))) return staged
  }
  const anchor = env.DSH_BUNDLE_ANCHORS?.trim()
  if (anchor) {
    const staged = join(dirname(anchor), 'resources', 'wecom-skills')
    if (existsSync(join(staged, WECOM_SHARED_SKILL_ID, 'SKILL.md'))) return staged
    const resourcesRoot = join(dirname(anchor), 'src-tauri', 'resources')
    if (existsSync(resourcesRoot)) {
      for (const name of readdirSync(resourcesRoot)) {
        if (!name.startsWith('runtime-')) continue
        const nested = join(resourcesRoot, name, 'app', WECOM_BUNDLED_SKILLS_REL)
        if (existsSync(join(nested, WECOM_SHARED_SKILL_ID, 'SKILL.md'))) return nested
      }
    }
  }
  return undefined
}

/**
 * True when the Host is the production/staged desktop sidecar (skills must be on disk).
 * `tauri dev` also sets `DSH_APP_ROOT` / `DSH_NODE_BINARY=node` — those must not block
 * the development GitHub skill fallback.
 */
function isPackagedDesktopRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DSH_DESKTOP_DEVELOPMENT?.trim()) return false
  if (env.DSH_WECOM_SKILLS_DIR?.trim() || env.DSH_DWS_SKILL_DIR?.trim()) return true
  const nodeBin = env.DSH_NODE_BINARY?.trim()
  // Production layout: `runtime-<ver>/node[.exe]` beside `runtime-<ver>/app/document-tool.mjs`.
  return Boolean(nodeBin && existsSync(join(dirname(nodeBin), 'app', 'document-tool.mjs')))
}

/**
 * Resolve the `wecom-cli` executable: product bundle first, then PATH.
 * @param env - process environment; overridable in tests.
 * @returns absolute shim/binary path, or undefined when not found.
 */
export function resolveWeComCliCommand(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (env === process.env && resolvedWecomCommand !== null) {
    return resolvedWecomCommand
  }
  const bundled = resolveBundledWeComCli(env)
  if (bundled !== undefined) {
    if (env === process.env) resolvedWecomCommand = bundled
    return bundled
  }
  const pathValue = env.PATH ?? env.Path ?? ''
  const names = process.platform === 'win32'
    ? ['wecom-cli.exe', 'wecom-cli.cmd', 'wecom-cli']
    : ['wecom-cli']
  for (const dir of pathValue.split(delimiter)) {
    if (dir.trim() === '') continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) {
        if (env === process.env) resolvedWecomCommand = candidate
        return candidate
      }
    }
  }
  if (env === process.env) resolvedWecomCommand = undefined
  return undefined
}

function composeStatus(
  dshHome: string,
  cliInstalled: boolean,
  cliVersion: string | null,
  authed: boolean,
): WeComCliStatus {
  const skillInstalled = existsSync(join(wecomSharedSkillDir(dshHome), 'SKILL.md'))
  let hint: string | null = null
  if (!cliInstalled) {
    hint = '未找到随包 wecom-cli。请使用最新桌面安装包，或临时执行 npm install -g @wecom/cli 后重启。'
  } else if (!authed) {
    hint = '点击「连接」，在浏览器中用企业微信扫码完成授权。'
  }
  // Authorized but the skill is not on disk yet: the sheet shows only「连接」.
  return {
    cliInstalled,
    cliVersion,
    authed,
    skillInstalled,
    hint,
    authorizing: false,
    authorizeError: null,
  }
}

/**
 * Overlay the in-process login flight onto a status snapshot.
 * Cached snapshots stay free of flight flags so a finished login is not stuck authorizing.
 * @param status - snapshot from disk and `wecom-cli auth show`.
 * @returns the same object when no flight flag differs, otherwise a copy.
 */
function withLoginFlags(status: WeComCliStatus): WeComCliStatus {
  const authorizing = loginFlight !== null
  if (status.authorizing === authorizing && status.authorizeError === loginError) return status
  return { ...status, authorizing, authorizeError: loginError }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Stop a browser login so a later status poll cannot write skills after「解绑」. */
function cancelWeComLogin(): void {
  loginEpoch += 1
  loginError = null
  const child = loginChild
  loginChild = null
  if (child !== null && child.exitCode === null) child.kill('SIGKILL')
  // Drop the flight before its finally runs so status no longer reports authorizing.
  loginFlight = null
}

/**
 * Drop an in-process browser login without clearing CLI credentials.
 * Disconnect uses this; Host tests call it between cases.
 */
export function cancelWeComCliLoginFlight(): void {
  cancelWeComLogin()
}

/**
 * Read wecom-cli install + auth + skill presence without mutating disk.
 * Spawns at most one `wecom-cli auth show --status`.
 * @param dshHome - product DSH home for skill detection.
 * @param options.fresh - When true, bypass the TTL cache.
 * @returns connector status payload.
 */
export async function buildWeComCliStatus(
  dshHome: string,
  options?: { fresh?: boolean },
): Promise<WeComCliStatus> {
  const fresh = options?.fresh === true
  // A second `wecom-cli` process during `auth init` can block on the CLI lock and
  // hold another WebView request open until the browser round-trip aborts it.
  if (loginFlight !== null && !fresh) {
    const base = statusCache !== null && statusCache.home === dshHome
      ? statusCache.status
      : composeStatus(dshHome, resolveWeComCliCommand() !== undefined, null, false)
    return withLoginFlags(base)
  }
  if (!fresh && statusCache !== null
    && statusCache.home === dshHome
    && Date.now() - statusCache.at < STATUS_CACHE_TTL_MS) {
    return withLoginFlags(statusCache.status)
  }
  if (!fresh && statusInflight !== null) return statusInflight.then(withLoginFlags)

  const probe = (async (): Promise<WeComCliStatus> => {
    const cli = resolveWeComCliCommand()
    if (cli === undefined) {
      return composeStatus(dshHome, false, null, false)
    }
    const auth = await run(cli, ['auth', 'show', '--status'])
    const line = auth.stdout.trim().split(/\r?\n/).find(entry => entry.trim() !== '') ?? ''
    const authed = auth.code === 0 && line === 'authorized'
    return composeStatus(dshHome, true, null, authed)
  })()

  statusInflight = probe
  try {
    const status = await probe
    statusCache = { at: Date.now(), home: dshHome, status }
    return withLoginFlags(status)
  } finally {
    if (statusInflight === probe) statusInflight = null
  }
}

/**
 * Copy `wecomcli-*` skill directories from a source root into `$DSH_HOME/skills`.
 * @param dshHome - product DSH home.
 * @param sourceSkills - directory that directly contains `wecomcli-*` folders.
 * @returns install root.
 */
function copyWeComSkillsFrom(dshHome: string, sourceSkills: string): string {
  const skillsRoot = wecomSkillsInstallRoot(dshHome)
  mkdirSync(skillsRoot, { recursive: true })
  let copied = 0
  for (const name of readdirSync(sourceSkills)) {
    if (!name.startsWith('wecomcli-')) continue
    const from = join(sourceSkills, name)
    if (!existsSync(join(from, 'SKILL.md'))) continue
    const dest = join(skillsRoot, name)
    rmSync(dest, { recursive: true, force: true })
    cpSync(from, dest, { recursive: true })
    if (!existsSync(join(dest, 'SKILL.md'))) {
      throw new Error(`写入企业微信技能失败（${name} 缺少 SKILL.md）`)
    }
    copied += 1
  }
  if (copied === 0 || !existsSync(join(wecomSharedSkillDir(dshHome), 'SKILL.md'))) {
    throw new Error('企业微信技能写入失败（未找到可复制的 wecomcli-* 技能）')
  }
  return skillsRoot
}

/**
 * Install official WeCom Agent Skills into `$DSH_HOME/skills/wecomcli-*`.
 * Prefers skills staged with the desktop runtime; downloads from GitHub only as fallback.
 * @param dshHome - product DSH home.
 * @returns skills root after install.
 */
export async function installWeComCliSkills(dshHome: string): Promise<string> {
  const bundled = resolveBundledWeComSkillsDir()
  if (bundled !== undefined) {
    return copyWeComSkillsFrom(dshHome, bundled)
  }
  // Packaged desktop must ship skills under `app/assets/wecom-skills`; do not fetch GitHub
  // at connect time (intranet / Failed to fetch). Development may still download once.
  if (isPackagedDesktopRuntime()) {
    throw new Error('安装包缺少企业微信技能资源（app/assets/wecom-skills）。请使用完整桌面安装包。')
  }
  const skillsRoot = wecomSkillsInstallRoot(dshHome)
  mkdirSync(skillsRoot, { recursive: true })
  const tmp = mkdtempSync(join(tmpdir(), 'wanwei-wecom-skills-'))
  try {
    const archive = join(tmp, 'wecom-cli.tar.gz')
    let response: Response
    try {
      response = await fetch(WECOM_CLI_SKILLS_TARBALL)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `无法从 GitHub 下载企业微信技能（${detail}）。请检查网络，或使用已随包技能资源的桌面安装包。`,
      )
    }
    if (!response.ok) {
      throw new Error(`下载企业微信技能失败（HTTP ${String(response.status)}）`)
    }
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()))
    const extract = await run('tar', ['-xzf', archive, '-C', tmp], 120_000)
    if (extract.code !== 0) {
      const detail = (extract.stderr || extract.stdout).trim().slice(0, 400)
      throw new Error(detail === '' ? '解压企业微信技能失败' : detail)
    }
    const extractedRoot = readdirSync(tmp)
      .map(name => join(tmp, name))
      .find(path => existsSync(join(path, 'skills', WECOM_SHARED_SKILL_ID, 'SKILL.md')))
    if (extractedRoot === undefined) {
      throw new Error('企业微信技能包中未找到 wecomcli-shared')
    }
    return copyWeComSkillsFrom(dshHome, join(extractedRoot, 'skills'))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * Remove installed wecomcli-* skill directories under the product home.
 * @param dshHome - product DSH home.
 */
export function removeWeComCliSkills(dshHome: string): void {
  const skillsRoot = wecomSkillsInstallRoot(dshHome)
  if (!existsSync(skillsRoot)) return
  for (const name of readdirSync(skillsRoot)) {
    if (!name.startsWith('wecomcli-')) continue
    rmSync(join(skillsRoot, name), { recursive: true, force: true })
  }
}

/**
 * Best-effort clear of encrypted wecom-cli credentials.
 * @param env - process environment; overridable in tests.
 */
export function clearWeComCliCredentials(env: NodeJS.ProcessEnv = process.env): void {
  try {
    const configDir = resolveWeComConfigDir(env)
    if (!existsSync(configDir)) return
    // Remove the whole config tree so the next「连接」must run auth init again.
    rmSync(configDir, { recursive: true, force: true })
  } catch {
    // Config dir may be unresolvable in stripped test envs; skill removal still unbinds desktop use.
  }
}

/**
 * Copy `wecomcli-*` skills after a background `wecom-cli auth init` exits.
 * The WebView request that started login has already returned; this still runs
 * if that request was aborted while the system browser was focused.
 * @param dshHome - product DSH home.
 * @param cli - absolute `wecom-cli` binary.
 * @param epoch - login generation; a newer「解绑」makes this a no-op.
 */
async function finishWeComLogin(dshHome: string, cli: string, epoch: number): Promise<void> {
  let result: RunResult
  try {
    result = await run(cli, ['auth', 'init', '--noninteractive'], 10 * 60_000, child => {
      loginChild = child
      child.once('close', () => {
        if (loginChild === child) loginChild = null
      })
    })
  } catch (error) {
    if (epoch !== loginEpoch) return
    loginError = errorText(error)
    invalidateWeComCliStatusCache()
    return
  }
  if (epoch !== loginEpoch) return
  if (result.code === null) {
    loginError = 'wecom-cli auth init 未能启动'
    invalidateWeComCliStatusCache()
    return
  }
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(0, 400)
    loginError = detail === '' ? 'wecom-cli auth init 未成功完成' : detail
    invalidateWeComCliStatusCache()
    return
  }
  loginError = null
  invalidateWeComCliStatusCache()
  const after = await buildWeComCliStatus(dshHome, { fresh: true })
  if (epoch !== loginEpoch) return
  if (after.authed && !after.skillInstalled) {
    try {
      await installWeComCliSkills(dshHome)
    } catch (error) {
      loginError = errorText(error)
      invalidateWeComCliStatusCache()
      return
    }
    invalidateWeComCliStatusCache()
  }
  await buildWeComCliStatus(dshHome, { fresh: true })
}

/**
 * Start non-interactive QR login (`wecom-cli auth init --noninteractive`), then install skills.
 * Already-authorized calls only copy skills and return when that copy finishes.
 * A new browser login returns as soon as the CLI is spawned. Holding the RPC open
 * until the QR process exits makes the WebView report a failed fetch.
 * @param dshHome - product DSH home.
 * @returns current status. `authorizing` stays true until the background login exits.
 */
export async function runWeComCliLogin(dshHome: string): Promise<WeComCliStatus> {
  if (loginFlight !== null) return buildWeComCliStatus(dshHome)
  loginError = null
  const before = await buildWeComCliStatus(dshHome, { fresh: true })
  if (!before.cliInstalled) {
    throw new Error(before.hint ?? 'wecom-cli 未安装')
  }
  const cli = resolveWeComCliCommand()
  if (cli === undefined) throw new Error(before.hint ?? 'wecom-cli 未安装')
  if (before.authed) {
    if (!before.skillInstalled) {
      await installWeComCliSkills(dshHome)
      invalidateWeComCliStatusCache()
    }
    return buildWeComCliStatus(dshHome, { fresh: true })
  }
  const epoch = loginEpoch
  const flight = finishWeComLogin(dshHome, cli, epoch)
  loginFlight = flight
  void flight.finally(() => {
    if (loginFlight === flight) loginFlight = null
  })
  return withLoginFlags(before)
}

/**
 * Unbind desktop WeCom: clear CLI credentials when present, then remove skill copies.
 * @param dshHome - product DSH home.
 * @returns status after unbind.
 */
export async function disconnectWeComCli(dshHome: string): Promise<WeComCliStatus> {
  cancelWeComLogin()
  clearWeComCliCredentials()
  removeWeComCliSkills(dshHome)
  invalidateWeComCliStatusCache()
  return buildWeComCliStatus(dshHome, { fresh: true })
}

/**
 * When wecom-cli auth already succeeded, copy bundled skills if `wecomcli-shared` is missing.
 * @param dshHome - product DSH home.
 * @returns refreshed status.
 */
export async function ensureWeComSkillsInstalled(dshHome: string): Promise<WeComCliStatus> {
  const status = await buildWeComCliStatus(dshHome, { fresh: true })
  if (!status.authed || status.skillInstalled) return status
  if (resolveBundledWeComSkillsDir() === undefined && isPackagedDesktopRuntime()) {
    return status
  }
  try {
    await installWeComCliSkills(dshHome)
  } catch {
    // Leave the existing hint when the source pack is absent or the copy fails.
    return buildWeComCliStatus(dshHome, { fresh: true })
  }
  invalidateWeComCliStatusCache()
  return buildWeComCliStatus(dshHome, { fresh: true })
}

/**
 * Register `/wanwei-wecom` RPC for wecom-cli auth + skill enablement.
 * @param ctx - Host context with connection.
 * @returns disposer from `ctx.effect`.
 */
export function registerWeComCliRpc(ctx: Context): () => void {
  const connection = ctx.get('connection') as HostConnectionHandle
  const dshHome = () => resolveProductDshHome()
  return ctx.effect(() => connection.rpc.handle('/wanwei-wecom', async (endpoint, _payload) => {
    try {
      if (endpoint === 'status') {
        // Do not auto-write skills here: after「解绑」a status poll must not silently reconnect.
        return { ok: true as const, value: await buildWeComCliStatus(dshHome()) }
      }
      if (endpoint === 'login') {
        return { ok: true as const, value: await runWeComCliLogin(dshHome()) }
      }
      if (endpoint === 'installSkill') {
        await installWeComCliSkills(dshHome())
        invalidateWeComCliStatusCache()
        return { ok: true as const, value: await buildWeComCliStatus(dshHome(), { fresh: true }) }
      }
      if (endpoint === 'disconnect') {
        return { ok: true as const, value: await disconnectWeComCli(dshHome()) }
      }
      throw new Error('未知企业微信连接器操作')
    } catch (error) {
      return {
        ok: false as const,
        error: {
          code: 'internal',
          message: error instanceof Error ? error.message : String(error),
          details: {},
        },
      }
    }
  }), 'wanwei-connectors: wecom CLI RPC')
}
