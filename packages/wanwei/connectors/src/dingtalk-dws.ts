/**
 * Desktop DingTalk “connected” means personal DWS auth + the dws-cli skill,
 * so the Wanwei agent can run DingTalk product commands (docs/tables/calendar/…)
 * in desktop chat. The product ships `dingtalk-workspace-cli` (`dws`) in the
 * desktop runtime (WorkBuddy-style); PATH / npm -g is only a fallback.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'

const require = createRequire(import.meta.url)

/** How long a Host status snapshot may be reused without re-spawning `dws`. */
const STATUS_CACHE_TTL_MS = 45_000

/** Non-secret DWS + skill status for the connectors page. */
export type DingTalkDwsStatus = {
  dwsInstalled: boolean
  dwsVersion: string | null
  authed: boolean
  skillInstalled: boolean
  /** Short hint when something blocks desktop skill use. */
  hint: string | null
  /** True until a lock-free status shows a saved login and the skill is installed, or the login fails. */
  authorizing: boolean
  /** Failure text from the latest background login, or null. */
  authorizeError: string | null
}

type RunResult = { code: number | null; stdout: string; stderr: string }

type StatusCacheEntry = { at: number; home: string; status: DingTalkDwsStatus }

let statusCache: StatusCacheEntry | null = null
let statusInflight: Promise<DingTalkDwsStatus> | null = null
let resolvedDwsCommand: string | undefined | null = null
let loginFlight: Promise<void> | null = null
let loginChild: ChildProcess | null = null
let loginEpoch = 0
let loginError: string | null = null
let cliTail: Promise<void> = Promise.resolve()
let statusProbeHolds = 0

/** Drop the in-process status cache after login / disconnect / skill install. */
export function invalidateDingTalkDwsStatusCache(): void {
  statusCache = null
  statusInflight = null
  resolvedDwsCommand = null
}

/**
 * Resolve the product DSH home used for user-scoped skills.
 * @param env - process environment.
 * @returns absolute DSH home path.
 */
export function resolveProductDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME?.trim()
  if (home) return home
  throw new Error('DSH_HOME is unset; desktop must set the product home before DingTalk skill install')
}

/** Relative dws-cli skill root under the staged desktop runtime app (WorkBuddy-style). */
export const DWS_BUNDLED_SKILL_REL = join('assets', 'dws-cli')

/**
 * Candidate roots that may contain `@dingtalk-real-ai/dsh-dingtalk`.
 * The connectors package does not depend on it; the desktop product / profile does.
 * @param env - process environment.
 * @returns package root directories to probe.
 */
function dingtalkPackageRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots: string[] = []
  const nodeBin = env.DSH_NODE_BINARY?.trim()
  if (nodeBin) {
    // Production: `runtime-<ver>/node[.exe]` beside `runtime-<ver>/app/node_modules`.
    roots.push(join(dirname(nodeBin), 'app', 'node_modules', '@dingtalk-real-ai', 'dsh-dingtalk'))
  }
  const anchor = env.DSH_BUNDLE_ANCHORS?.trim()
  if (anchor) {
    roots.push(join(dirname(anchor), 'node_modules', '@dingtalk-real-ai', 'dsh-dingtalk'))
  }
  try {
    roots.push(dirname(require.resolve('@dingtalk-real-ai/dsh-dingtalk/package.json')))
  } catch {
    // Expected when this package is resolved outside the desktop product graph.
  }
  const cwd = process.cwd()
  const home = env.DSH_HOME?.trim()
  const searchFrom = [cwd, home, home ? join(home, '..') : undefined, home ? join(home, '..', '..') : undefined]
  for (const base of searchFrom) {
    if (!base) continue
    roots.push(join(base, 'node_modules', '@dingtalk-real-ai', 'dsh-dingtalk'))
  }
  // Walk up from this module toward the monorepo / product install.
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 10; i++) {
    roots.push(join(dir, 'node_modules', '@dingtalk-real-ai', 'dsh-dingtalk'))
    roots.push(join(dir, 'products', 'wanwei-desktop', 'node_modules', '@dingtalk-real-ai', 'dsh-dingtalk'))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return roots
}

/**
 * Locate the bundled dws-cli skill: staged runtime assets first, then the npm package.
 * @param env - process environment; overridable in tests.
 * @returns absolute skill directory, or undefined when the package is absent.
 */
export function resolveBundledDwsCliSkillDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env.DSH_DWS_SKILL_DIR?.trim()
  if (override && existsSync(join(override, 'SKILL.md'))) return override
  const nodeBin = env.DSH_NODE_BINARY?.trim()
  if (nodeBin) {
    const staged = join(dirname(nodeBin), 'app', DWS_BUNDLED_SKILL_REL)
    if (existsSync(join(staged, 'SKILL.md'))) return staged
  }
  // Production sidecar `cwd` is `runtime-<ver>/app` (document-tool.mjs sibling).
  const appRoot = env.DSH_APP_ROOT?.trim() || process.cwd()
  const cwdStaged = join(appRoot, DWS_BUNDLED_SKILL_REL)
  if (existsSync(join(cwdStaged, 'SKILL.md'))) return cwdStaged
  const documentTool = env.DSH_DOCUMENT_TOOL?.trim()
  if (documentTool) {
    const staged = join(dirname(documentTool), DWS_BUNDLED_SKILL_REL)
    if (existsSync(join(staged, 'SKILL.md'))) return staged
  }
  const anchor = env.DSH_BUNDLE_ANCHORS?.trim()
  if (anchor) {
    const staged = join(dirname(anchor), 'resources', 'dws-cli')
    if (existsSync(join(staged, 'SKILL.md'))) return staged
    // After `prepare:runtime`, skills live under src-tauri/resources/runtime-*/app/assets.
    const resourcesRoot = join(dirname(anchor), 'src-tauri', 'resources')
    if (existsSync(resourcesRoot)) {
      for (const name of readdirSync(resourcesRoot)) {
        if (!name.startsWith('runtime-')) continue
        const nested = join(resourcesRoot, name, 'app', DWS_BUNDLED_SKILL_REL)
        if (existsSync(join(nested, 'SKILL.md'))) return nested
      }
    }
  }
  for (const root of dingtalkPackageRoots(env)) {
    const skill = join(root, 'assets', 'skills', 'dws-cli')
    if (existsSync(join(skill, 'SKILL.md'))) return skill
  }
  return undefined
}

/**
 * User-scoped install path discovered by skill-filesystem (`$DSH_HOME/skills`).
 * @param dshHome - product DSH home.
 * @returns destination directory for the dws-cli skill.
 */
export function dwsCliSkillInstallDir(dshHome: string): string {
  return join(dshHome, 'skills', 'dws-cli')
}

function run(
  cmd: string,
  args: readonly string[],
  timeoutMs = 15_000,
  onChild?: (child: ChildProcess) => void,
  settleOnExit = false,
): Promise<RunResult> {
  // npm `.cmd` shims need a shell on Windows; the native `dws.exe` does not.
  const shell = process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(cmd)
  return new Promise((resolve) => {
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
    child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    let settled = false
    const settle = (code: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (settleOnExit) {
        child.stdout?.destroy()
        child.stderr?.destroy()
      }
      resolve({ code, stdout, stderr })
    }
    child.on('error', () => { settle(null) })
    if (settleOnExit) child.on('exit', (code) => { settle(code) })
    else child.on('close', (code) => { settle(code) })
  })
}

function dwsBinaryFileName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'dws.exe' : 'dws'
}

/**
 * Candidate `node_modules` roots that may contain product-bundled `dingtalk-workspace-cli`.
 * @param env - process environment.
 * @returns directories to probe.
 */
function dwsNodeModulesRoots(env: NodeJS.ProcessEnv): string[] {
  const roots: string[] = []
  const nodeBin = env.DSH_NODE_BINARY?.trim()
  if (nodeBin) {
    roots.push(join(dirname(nodeBin), 'app', 'node_modules'))
  }
  const anchor = env.DSH_BUNDLE_ANCHORS?.trim()
  if (anchor) {
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
 * Resolve the product-bundled DWS native binary (WorkBuddy-style; no npm -g).
 * @param env - process environment; overridable in tests.
 * @returns absolute binary path, or undefined when not staged.
 */
export function resolveBundledDwsCommand(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env.DSH_DWS_CLI?.trim()
  if (override && existsSync(override)) return override
  const binaryName = dwsBinaryFileName()
  for (const root of dwsNodeModulesRoots(env)) {
    const candidate = join(root, 'dingtalk-workspace-cli', 'vendor', binaryName)
    if (existsSync(candidate)) return candidate
  }
  try {
    const pkgJson = require.resolve('dingtalk-workspace-cli/package.json')
    const candidate = join(dirname(pkgJson), 'vendor', binaryName)
    if (existsSync(candidate)) return candidate
  } catch {
    // Expected when the desktop product has not installed dingtalk-workspace-cli yet.
  }
  return undefined
}

/**
 * Resolve the `dws` executable: product bundle first, then PATH.
 * @param env - process environment; overridable in tests.
 * @returns absolute shim/binary path, or undefined when not found.
 */
export function resolveDwsCommand(env: NodeJS.ProcessEnv = process.env): string | undefined {
  // PATH / bundle roots are stable for the Host process; avoid re-walking every poll.
  if (env === process.env && resolvedDwsCommand !== null) {
    return resolvedDwsCommand
  }
  const bundled = resolveBundledDwsCommand(env)
  if (bundled !== undefined) {
    if (env === process.env) resolvedDwsCommand = bundled
    return bundled
  }
  const pathValue = env.PATH ?? env.Path ?? ''
  const names = process.platform === 'win32' ? ['dws.exe', 'dws.cmd', 'dws'] : ['dws']
  for (const dir of pathValue.split(delimiter)) {
    if (dir.trim() === '') continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) {
        if (env === process.env) resolvedDwsCommand = candidate
        return candidate
      }
    }
  }
  if (env === process.env) resolvedDwsCommand = undefined
  return undefined
}

/**
 * Read personal-login state from `dws auth status --format json` stdout.
 * Unauthenticated runs still exit 0 with `{ "authenticated": false }`.
 * @param stdout - CLI stdout (may include a leading version_check object).
 * @returns true only when the CLI reports an active login.
 */
export function parseDwsAuthenticated(stdout: string): boolean {
  const text = stdout.trim()
  let start = -1
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (char !== '}' || depth === 0) continue
    depth -= 1
    if (depth !== 0 || start < 0) continue
    try {
      const record = JSON.parse(text.slice(start, index + 1)) as { authenticated?: unknown }
      if (record.authenticated === true) return true
    } catch {
      // Keep scanning: the CLI may print a diagnostic object before status JSON.
    }
    start = -1
  }
  return false
}

function composeStatus(
  dshHome: string,
  dwsInstalled: boolean,
  dwsVersion: string | null,
  authed: boolean,
): DingTalkDwsStatus {
  const skillInstalled = existsSync(join(dwsCliSkillInstallDir(dshHome), 'SKILL.md'))
  let hint: string | null = null
  if (!dwsInstalled) {
    hint = '未找到随包 dws。请使用最新桌面安装包，或临时执行 npm install -g dingtalk-workspace-cli 后重启。'
  } else if (!authed) {
    hint = '点击「连接」，在浏览器中完成钉钉扫码或头像授权。'
  }
  // Authorized but the skill is not on disk yet: the sheet shows only「连接」.
  return {
    dwsInstalled,
    dwsVersion,
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
 * @param status - snapshot from disk and `dws auth status`.
 * @returns the same object when no flight flag differs, otherwise a copy.
 */
function withLoginFlags(status: DingTalkDwsStatus): DingTalkDwsStatus {
  const authorizing = loginFlight !== null
  if (status.authorizing === authorizing && status.authorizeError === loginError) return status
  return { ...status, authorizing, authorizeError: loginError }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Run CLI work one process at a time. Callers return before `task` finishes.
 * @param task - logout, status, or browser login. Must not start another queued CLI task.
 * @returns the task's completion. Rejects when `task` throws.
 */
function enqueueCli(task: () => Promise<void>): Promise<void> {
  const run = cliTail.then(task, task)
  cliTail = run.then(() => undefined, () => undefined)
  return run
}

/** Block non-fresh status probes until the matching CLI work finishes. */
function holdStatusProbes(): () => void {
  statusProbeHolds += 1
  let released = false
  return () => {
    if (released) return
    released = true
    statusProbeHolds -= 1
  }
}

/** Stop a browser login so a later status poll cannot write skills after「解绑」. */
function cancelDingTalkLogin(): void {
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
export function cancelDingTalkDwsLoginFlight(): void {
  cancelDingTalkLogin()
}

/**
 * Read DWS install + auth + skill presence without mutating disk.
 * Spawns at most one `dws auth status` (PATH presence implies install; no separate `--version`).
 * Results are cached briefly and coalesced while a probe is in flight.
 * @param dshHome - product DSH home for skill detection.
 * @param options.fresh - When true, bypass the TTL cache (mutations / explicit refresh).
 * @returns connector status payload.
 */
export async function buildDingTalkDwsStatus(
  dshHome: string,
  options?: { fresh?: boolean },
): Promise<DingTalkDwsStatus> {
  const fresh = options?.fresh === true
  // A second `dws` process during `auth login` can block on the CLI lock and
  // hold another WebView request open until the browser round-trip aborts it.
  if (!fresh && (loginFlight !== null || statusProbeHolds > 0)) {
    const base = statusCache !== null && statusCache.home === dshHome
      ? statusCache.status
      : composeStatus(dshHome, resolveDwsCommand() !== undefined, null, false)
    return withLoginFlags(base)
  }
  if (!fresh && statusCache !== null
    && statusCache.home === dshHome
    && Date.now() - statusCache.at < STATUS_CACHE_TTL_MS) {
    return withLoginFlags(statusCache.status)
  }
  if (!fresh && statusInflight !== null) return statusInflight.then(withLoginFlags)

  const probe = (async (): Promise<DingTalkDwsStatus> => {
    const dws = resolveDwsCommand()
    if (dws === undefined) {
      return composeStatus(dshHome, false, null, false)
    }
    // PATH hit means the CLI shim/binary is installed; skip a second cold spawn for `--version`.
    const auth = await run(dws, ['auth', 'status', '--format', 'json'])
    const dwsInstalled = true
    // `dws auth status` exits 0 even when logged out; trust JSON `authenticated` only.
    const authed = parseDwsAuthenticated(auth.stdout)
    return composeStatus(dshHome, dwsInstalled, null, authed)
  })()

  statusInflight = probe
  try {
    const status = await probe
    // A login started while this probe was running owns the cache. Do not let
    // its pre-login result overwrite a connected snapshot.
    if (loginFlight === null && statusProbeHolds === 0) {
      statusCache = { at: Date.now(), home: dshHome, status }
    }
    return withLoginFlags(status)
  } finally {
    if (statusInflight === probe) statusInflight = null
  }
}

/**
 * Copy the official bundled dws-cli skill into `$DSH_HOME/skills/dws-cli`.
 * Replaces any empty or partial destination left by a prior failed write.
 * @param dshHome - product DSH home.
 * @returns absolute install directory.
 */
export function installDwsCliSkill(dshHome: string): string {
  const source = resolveBundledDwsCliSkillDir()
  if (source === undefined) {
    throw new Error('未找到随包 dws-cli 技能（需要 app/assets/dws-cli 或 @dingtalk-real-ai/dsh-dingtalk）。请使用完整桌面安装包。')
  }
  if (!existsSync(join(source, 'SKILL.md'))) {
    throw new Error(`随包 dws-cli 技能损坏（缺少 SKILL.md）：${source}`)
  }
  const dest = dwsCliSkillInstallDir(dshHome)
  mkdirSync(dirname(dest), { recursive: true })
  rmSync(dest, { recursive: true, force: true })
  cpSync(source, dest, { recursive: true })
  if (!existsSync(join(dest, 'SKILL.md'))) {
    throw new Error(`写入 dws-cli 技能失败（目标缺少 SKILL.md）：${dest}`)
  }
  return dest
}

/** `dws auth status --readonly` does not take the auth lock held by `dws auth login`. */
const READONLY_STATUS_ARGS = ['auth', 'status', '--readonly', '--format', 'json'] as const
const READONLY_STATUS_TIMEOUT_MS = 8_000
const LOGIN_POLL_MS = 1_000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Read the local DWS snapshot without taking the auth lock.
 * @param dws - absolute `dws` binary.
 * @returns true when the snapshot reports an active personal login.
 */
async function readDingTalkReadonlyAuthed(dws: string): Promise<boolean> {
  const auth = await run(dws, READONLY_STATUS_ARGS, READONLY_STATUS_TIMEOUT_MS)
  return parseDwsAuthenticated(auth.stdout)
}

/** End the waiting state for this login generation. A newer「解绑」is left alone. */
function releaseDingTalkFlight(epoch: number): void {
  if (epoch !== loginEpoch) return
  loginFlight = null
}

/**
 * Store a connected snapshot and end the waiting state.
 * Status probes stay held until `dws auth login` exits, so a locking status is not started beside it.
 * @param dshHome - product DSH home.
 * @param epoch - login generation captured when the flight started.
 * @returns false when a newer unbind wins or the skill copy fails.
 */
async function publishDingTalkAuthorized(dshHome: string, epoch: number): Promise<boolean> {
  if (epoch !== loginEpoch) return false
  loginError = null
  if (!existsSync(join(dwsCliSkillInstallDir(dshHome), 'SKILL.md'))) {
    try {
      installDwsCliSkill(dshHome)
    } catch (error) {
      if (epoch !== loginEpoch) return false
      loginError = errorText(error)
      invalidateDingTalkDwsStatusCache()
      releaseDingTalkFlight(epoch)
      return false
    }
  }
  if (epoch !== loginEpoch) return false
  statusCache = {
    at: Date.now(),
    home: dshHome,
    status: composeStatus(dshHome, true, null, true),
  }
  releaseDingTalkFlight(epoch)
  // Browser processes can inherit the hidden release sidecar's stdout/stderr
  // handles. Stop the completed login so its queued task cannot wait forever
  // for those inherited pipes to close and block unbind or the next login.
  const child = loginChild
  if (child !== null && child.exitCode === null) child.kill('SIGKILL')
  return true
}

/**
 * Copy `dws-cli` when a lock-free status shows the browser login has saved tokens.
 * The WebView request that started login has already returned. `dws auth login` may
 * still be running; that process holds the auth lock, so success is not its exit.
 * @param dshHome - product DSH home.
 * @param dws - absolute `dws` binary.
 * @param epoch - login generation; a newer「解绑」makes this a no-op.
 */
async function finishDingTalkLogin(dshHome: string, dws: string, epoch: number): Promise<void> {
  if (epoch !== loginEpoch) return
  if (await readDingTalkReadonlyAuthed(dws)) {
    await publishDingTalkAuthorized(dshHome, epoch)
    return
  }
  if (epoch !== loginEpoch) return
  let published = false
  let stopWatch = false
  const watch = (async () => {
    while (!stopWatch && epoch === loginEpoch) {
      await delay(LOGIN_POLL_MS)
      if (stopWatch || epoch !== loginEpoch) return
      if (!(await readDingTalkReadonlyAuthed(dws))) continue
      if (stopWatch || epoch !== loginEpoch) return
      published = await publishDingTalkAuthorized(dshHome, epoch)
      return
    }
  })()
  const result = await run(
    dws,
    ['auth', 'login'],
    10 * 60_000,
    (child) => {
      loginChild = child
      child.once('exit', () => {
        if (loginChild === child) loginChild = null
      })
    },
    true,
  )
  stopWatch = true
  await watch
  if (epoch !== loginEpoch || published || loginFlight === null) return
  if (result.code === 0 && await readDingTalkReadonlyAuthed(dws)) {
    await publishDingTalkAuthorized(dshHome, epoch)
    return
  }
  if (epoch !== loginEpoch || loginFlight === null) return
  if (result.code === null) {
    loginError = 'dws auth login 未能启动'
  } else if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim().slice(0, 400)
    loginError = detail === '' ? 'dws auth login 未成功完成' : detail
  } else {
    loginError = 'dws auth login 已退出，但本地登录状态尚未生效'
  }
  invalidateDingTalkDwsStatusCache()
  releaseDingTalkFlight(epoch)
}

/**
 * Start interactive personal login. The CLI owns QR / device / PC-session reuse.
 * The call queues `dws auth login` and returns before that process starts, so a
 * later「连接」does not wait on a background `dws auth logout`. `authorizing`
 * clears when `dws auth status --readonly` reports a saved login and the skill is installed.
 * @param dshHome - product DSH home.
 * @returns current status. `authorizing` stays true until that readonly snapshot succeeds or the login fails.
 */
export async function runDingTalkDwsLogin(dshHome: string): Promise<DingTalkDwsStatus> {
  if (loginFlight !== null) return buildDingTalkDwsStatus(dshHome)
  loginError = null
  const dws = resolveDwsCommand()
  if (dws === undefined) {
    const missing = await buildDingTalkDwsStatus(dshHome)
    throw new Error(missing.hint ?? 'dws 未安装')
  }
  // Return before any CLI process starts. A fresh `dws auth status` here can sit
  // behind logout and the WebView reports that wait as a lost local connection.
  const epoch = loginEpoch
  const release = holdStatusProbes()
  const flight = enqueueCli(async () => {
    try {
      await finishDingTalkLogin(dshHome, dws, epoch)
    } finally {
      release()
    }
  })
  loginFlight = flight
  void flight.finally(() => {
    if (loginFlight === flight) loginFlight = null
  })
  return withLoginFlags(composeStatus(dshHome, true, null, false))
}

/**
 * Unbind desktop DingTalk: remove the skill copy and return. `dws auth logout` runs afterward.
 * @param dshHome - product DSH home.
 * @returns status after unbind.
 */
export async function disconnectDingTalkDws(dshHome: string): Promise<DingTalkDwsStatus> {
  cancelDingTalkLogin()
  const dest = dwsCliSkillInstallDir(dshHome)
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
  invalidateDingTalkDwsStatusCache()
  const dws = resolveDwsCommand()
  if (dws !== undefined) {
    const epoch = loginEpoch
    const release = holdStatusProbes()
    void enqueueCli(async () => {
      try {
        if (epoch !== loginEpoch) return
        // `-y` skips interactive confirm so Host unbind actually clears tokens.
        await run(dws, ['auth', 'logout', '-y'], 30_000)
        if (epoch !== loginEpoch) return
        invalidateDingTalkDwsStatusCache()
        const still = await buildDingTalkDwsStatus(dshHome, { fresh: true })
        if (epoch !== loginEpoch) return
        if (still.authed) {
          // Stronger wipe when logout left a live session (older CLI / multi-profile).
          await run(dws, ['auth', 'reset', '-y'], 30_000)
          invalidateDingTalkDwsStatusCache()
        }
      } finally {
        release()
      }
    })
  }
  return withLoginFlags(composeStatus(dshHome, dws !== undefined, null, false))
}

/**
 * When personal auth already succeeded, copy the bundled skill if `$DSH_HOME/skills/dws-cli` is missing.
 * Status probes call this so a second「连接」click is not required after OAuth.
 * @param dshHome - product DSH home.
 * @returns refreshed status.
 */
export async function ensureDingTalkSkillInstalled(dshHome: string): Promise<DingTalkDwsStatus> {
  const status = await buildDingTalkDwsStatus(dshHome, { fresh: true })
  if (!status.authed || status.skillInstalled) return status
  if (resolveBundledDwsCliSkillDir() === undefined) return status
  try {
    installDwsCliSkill(dshHome)
    invalidateDingTalkDwsStatusCache()
    return buildDingTalkDwsStatus(dshHome, { fresh: true })
  } catch {
    // Keep the「尚未写入」hint when the copy fails;「连接」can retry.
    return status
  }
}

/**
 * Register `/wanwei-dingtalk` RPC for DWS personal auth + skill enablement.
 * @param ctx - Host context with connection.
 * @returns disposer from `ctx.effect`.
 */
export function registerDingTalkDwsRpc(ctx: Context): () => void {
  const connection = ctx.get('connection') as HostConnectionHandle
  const dshHome = () => resolveProductDshHome()
  return ctx.effect(() => connection.rpc.handle('/wanwei-dingtalk', async (endpoint, _payload) => {
    try {
      if (endpoint === 'status') {
        // Do not auto-write skills here: after「解绑」a status poll must not silently reconnect.
        return { ok: true as const, value: await buildDingTalkDwsStatus(dshHome()) }
      }
      if (endpoint === 'login') {
        return { ok: true as const, value: await runDingTalkDwsLogin(dshHome()) }
      }
      if (endpoint === 'installSkill') {
        installDwsCliSkill(dshHome())
        invalidateDingTalkDwsStatusCache()
        return { ok: true as const, value: await buildDingTalkDwsStatus(dshHome(), { fresh: true }) }
      }
      if (endpoint === 'disconnect') {
        return { ok: true as const, value: await disconnectDingTalkDws(dshHome()) }
      }
      throw new Error('未知钉钉连接器操作')
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
  }), 'wanwei-connectors: dingtalk DWS RPC')
}

/**
 * 返回连接器模块所在目录。
 * @returns 当前模块的绝对目录路径。
 */
export function connectorsPackageDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}
