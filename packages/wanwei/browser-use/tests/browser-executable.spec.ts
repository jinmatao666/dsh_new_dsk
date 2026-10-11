import { afterEach, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { access, stat } from 'node:fs/promises'
import { browserCandidates, browserStartupFailure, resolveBrowserExecutable } from '../src/browser-executable.ts'

vi.mock('node:fs/promises', async original => ({
  ...await original<typeof import('node:fs/promises')>(), stat: vi.fn(), access: vi.fn(),
}))
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

it('searches Chrome before Edge across Windows installation roots', () => {
  const paths = browserCandidates('win32', { ProgramFiles: 'C:/Program Files', LOCALAPPDATA: 'C:/Users/test/AppData/Local' }, '/home/test')
  expect(paths).toEqual([
    join('C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
    join('C:/Users/test/AppData/Local', 'Google/Chrome/Application/chrome.exe'),
    join('C:/Program Files', 'Microsoft/Edge/Application/msedge.exe'),
    join('C:/Users/test/AppData/Local', 'Microsoft/Edge/Application/msedge.exe'),
  ])
  expect(browserCandidates('darwin', {}, '/Users/test')[0]).toBe(join('/Applications', 'Google Chrome.app/Contents/MacOS/Google Chrome'))
})

it('automatically resolves a runnable installed browser and falls back to Edge', async () => {
  const paths = browserCandidates(process.platform, process.env, process.env.USERPROFILE ?? '/home/test')
  const edge = paths.find(path => path.includes('Edge') || path.includes('microsoft-edge'))!
  vi.mocked(stat).mockImplementation(async (path) => {
    if (String(path) !== edge) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return { isFile: () => true } as Awaited<ReturnType<typeof stat>>
  })
  vi.mocked(access).mockResolvedValue(undefined)
  expect(await resolveBrowserExecutable()).toBe(edge)
})

it('does not download when no browser exists or silently replace an invalid explicit path', async () => {
  vi.mocked(stat).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
  expect(await resolveBrowserExecutable()).toBeUndefined()
  await expect(resolveBrowserExecutable('missing-browser')).rejects.toThrow('配置的浏览器路径不可用')
})

it('honors an accessible custom executable and classifies startup errors only', async () => {
  vi.mocked(stat).mockResolvedValue({ isFile: () => true } as Awaited<ReturnType<typeof stat>>)
  vi.mocked(access).mockResolvedValue(undefined)
  const custom = join(process.cwd(), 'custom-browser.exe')
  expect(await resolveBrowserExecutable(custom)).toBe(custom)
  expect(browserStartupFailure('Browser "chrome-for-testing" is not installed')).toBe(true)
  expect(browserStartupFailure('browserType.launch: spawn chrome.exe EACCES')).toBe(true)
  expect(browserStartupFailure('Timeout waiting for selector')).toBe(false)
  expect(browserStartupFailure('net::ERR_NAME_NOT_RESOLVED')).toBe(false)
})
