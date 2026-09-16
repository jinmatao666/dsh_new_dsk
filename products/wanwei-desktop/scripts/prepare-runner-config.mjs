import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const platform = process.argv[2]
const runnerByPlatform = {
  'windows-x64': 'Windows',
  'macos-arm64': 'macOS',
  'linux-x64': 'Linux',
}
const expectedRunner = runnerByPlatform[platform]

if (process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('Runner 配置只能由 GitHub Actions 生成')
}
if (expectedRunner === undefined) {
  throw new Error(`不支持的万维桌面构建平台：${platform ?? '(missing)'}`)
}
if (process.env.RUNNER_OS !== expectedRunner) {
  throw new Error(`${platform} 必须在 ${expectedRunner} Runner 上构建，当前为 ${process.env.RUNNER_OS ?? '(missing)'}`)
}

const version = process.env.DSH_RELEASE_VERSION?.trim() ?? ''
const semver = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/u
if (!semver.test(version)) throw new Error(`无效的 Tauri SemVer 版本：${version || '(missing)'}`)

const serviceUrl = process.env.DSH_DESKTOP_SERVER_URL?.trim() ?? ''
if (serviceUrl === '') throw new Error('DSH_ONEAPI_URL 仓库变量必须包含现有 OneAPI 服务地址')
const parsedUrl = new URL(serviceUrl)
if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
  throw new Error('DSH_ONEAPI_URL 必须使用 http 或 https')
}

const config = { version }
if (platform === 'macos-arm64') {
  config.bundle = { macOS: { signingIdentity: '-' } }
}

const runnerTemp = process.env.RUNNER_TEMP
if (runnerTemp === undefined) throw new Error('GitHub Actions 未提供 RUNNER_TEMP')
const configPath = join(runnerTemp, `wanwei-preview-${platform}.json`)
writeFileSync(configPath, `${JSON.stringify(config)}\n`)
process.stdout.write(`已准备 ${platform} 预览版配置：${configPath}\n`)
