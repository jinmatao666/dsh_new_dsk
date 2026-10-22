import { afterEach, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { PipMirrors } from '../src/pip-mirrors.ts'
import { ResourceRouting } from '../src/resource-routing.ts'
import { Config } from '../src/index.ts'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'

const indexes = ['https://first.invalid/simple/', 'https://second.invalid/simple/', 'https://third.invalid/simple/']
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

it('ships Huawei, Tsinghua and official PyPI in priority order with bounded attempts', () => {
  const config = Config({ provider: 'dsh-server', credentialRef: 'DSH_ONEAPI_TOKEN', tokenName: 'DSH Desktop Auto Token' })
  expect(config.pipMirrorUrls).toEqual([
    'https://repo.huaweicloud.com/repository/pypi/simple/',
    'https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple/',
    'https://pypi.org/simple/',
  ])
  expect(config.pipMirrorAttemptSeconds).toBe(30)
})

function fixture(outcomes: string[], attemptSeconds = 5) {
  const root = mkdtempSync(join(tmpdir(), 'pip-mirrors-test-'))
  cleanups.push(() => { rmSync(root, { recursive: true, force: true }) })
  const modules = join(root, 'modules')
  mkdirSync(join(modules, 'pip', '_internal', 'cli'), { recursive: true })
  for (const file of ['__init__.py', '_internal/__init__.py', '_internal/cli/__init__.py']) {
    writeFileSync(join(modules, 'pip', file), '__version__ = "fixture"\n')
  }
  // Only pip's external execution is substituted; the real Python module overlay and child processes run unchanged.
  writeFileSync(join(modules, 'pip', '_internal', 'cli', 'main.py'), `import json, os, sys, time
def main():
    indexes = ${JSON.stringify(indexes)}
    index = os.environ.get('PIP_INDEX_URL', '')
    with open(os.environ['PIP_TEST_TRACE'], 'a') as trace:
        trace.write(json.dumps({'index': index, 'proxy': os.environ.get('HTTPS_PROXY'), 'args': sys.argv[1:]}) + '\\n')
    outcome = json.loads(os.environ['PIP_TEST_OUTCOMES'])[indexes.index(index)]
    if outcome == 'sleep':
        time.sleep(20)
    if outcome == 'ok':
        print('Successfully downloaded fixture')
        return 0
    print(outcome)
    return 1
`)
  const mirrors = new PipMirrors({ indexes, attemptSeconds })
  cleanups.push(() => { mirrors.dispose() })
  const overlay = mirrors.start()
  const trace = join(root, 'trace.jsonl')
  const env = { ...process.env, PYTHONPATH: [overlay, modules].join(delimiter),
    DSH_PIP_MIRROR_CHILD: '', PIP_INDEX_URL: indexes[0], PIP_EXTRA_INDEX_URL: '', PIP_NO_INDEX: '',
    HTTPS_PROXY: 'http://127.0.0.1:3128', PIP_TEST_TRACE: trace, PIP_TEST_OUTCOMES: JSON.stringify(outcomes) }
  return { env, modules, overlay, mirrors,
    calls: () => existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line) as {
      index: string
      proxy: string
      args: string[]
    }) : [],
    run: (args: string[] = ['download', 'fixture']) => promisify(execFile)('python', ['-m', 'pip', ...args],
      { env, windowsHide: true, timeout: 25_000 }),
  }
}

it('uses only the first successful mirror and preserves the configured relay', async () => {
  const test = fixture(['ok', 'ok', 'ok'])
  expect((await test.run()).stdout).toContain('mirror 1/3: first.invalid')
  expect(test.calls().map(call => call.index)).toEqual(indexes.slice(0, 1))
  expect(test.calls()[0]?.proxy).toBe('http://127.0.0.1:3128')
})

it('falls back in order for missing distributions and proxy failures', async () => {
  const test = fixture(['ERROR: No matching distribution found', 'ProxyError: 502 Bad Gateway', 'ok'])
  expect((await test.run()).stdout).toContain('mirror 3/3: third.invalid')
  expect(test.calls().map(call => call.index)).toEqual(indexes)
})

it('runs ordered fallback through a real shell after the production environment scrub', async () => {
  const test = fixture(['ProxyError: 502 Bad Gateway', 'ok', 'ok'])
  const saved = new Map(Object.keys(test.env).map(key => [key, process.env[key]]))
  let env: Record<string, string>
  try {
    Object.assign(process.env, test.env)
    env = scrubbedParentEnv()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  }
  expect(Object.keys(env).some(key => key.toUpperCase().startsWith('DSH_'))).toBe(false)
  const shell = process.platform === 'win32' ? 'pwsh' : '/bin/sh'
  const args = process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', 'python -m pip download fixture; exit $LASTEXITCODE']
    : ['-c', 'python -m pip download fixture']
  const { stdout } = await promisify(execFile)(shell, args, { env, windowsHide: true, timeout: 25_000 })
  expect(stdout).toContain('[wanwei-pip] result: success')
  expect(test.calls().map(call => call.index)).toEqual(indexes.slice(0, 2))
  expect(test.calls().every(call => call.proxy === 'http://127.0.0.1:3128')).toBe(true)
})

it('stops after all indexes fail and retains the nonzero exit status', async () => {
  const test = fixture(['ProxyError', 'ProxyError', 'ProxyError'])
  await expect(test.run()).rejects.toMatchObject({ code: 1 })
  expect(test.calls()).toHaveLength(3)
})

it.each(['Permission denied', 'Failed building wheel', 'Invalid requirement', 'do not match the hashes'])(
  'does not retry terminal failure: %s', async (error) => {
    const test = fixture([error, 'ok', 'ok'])
    await expect(test.run()).rejects.toMatchObject({ code: 1 })
    expect(test.calls()).toHaveLength(1)
  },
)

it('bounds a hung attempt before trying the second mirror', async () => {
  const test = fixture(['sleep', 'ok', 'ok'], 1)
  expect((await test.run()).stdout).toContain('attempt timed out after 1 seconds')
  expect(test.calls().map(call => call.index)).toEqual(indexes.slice(0, 2))
})

it.each([
  ['install', 'fixture', '--no-index', '--find-links', 'wheels'],
  ['download', 'fixture', '--index-url=https://explicit.invalid/simple/'],
  ['download', 'fixture', '-ihttps://explicit.invalid/simple/'],
  ['--version'],
])('delegates explicit or local pip commands unchanged: %j', async (...args) => {
  const test = fixture(['ok', 'ok', 'ok'])
  expect((await test.run(args)).stdout).not.toContain('[wanwei-pip]')
  expect(test.calls()).toHaveLength(1)
  expect(test.calls()[0]?.args).toEqual(args)
})

it('preserves actual installed pip imports and version commands', async () => {
  const mirrors = new PipMirrors({ indexes, attemptSeconds: 5 })
  cleanups.push(() => { mirrors.dispose() })
  const { stdout } = await promisify(execFile)('python', ['-m', 'pip', '--version'], {
    windowsHide: true, timeout: 10_000, env: { ...process.env, PYTHONPATH: mirrors.start() },
  })
  expect(stdout).toMatch(/^pip \d/u)
})

it('runs the overlay in a newly created virtual environment without policy environment variables', async () => {
  const test = fixture(['ProxyError', 'ok', 'ok'])
  const root = mkdtempSync(join(tmpdir(), 'pip-mirror-venv-'))
  cleanups.push(() => { rmSync(root, { recursive: true, force: true }) })
  await promisify(execFile)('python', ['-m', 'venv', '--without-pip', join(root, 'venv')],
    { windowsHide: true, timeout: 25_000 })
  const interpreter = process.platform === 'win32' ? join(root, 'venv', 'Scripts', 'python.exe')
    : join(root, 'venv', 'bin', 'python')
  const env = Object.fromEntries(Object.entries(test.env).filter(([key]) => !key.toUpperCase().startsWith('DSH_')))
  const { stdout } = await promisify(execFile)(interpreter, ['-m', 'pip', 'install', 'fixture'],
    { env, windowsHide: true, timeout: 25_000 })
  expect(stdout).toContain('[wanwei-pip] result: success')
  expect(test.calls().map(call => call.index)).toEqual(indexes.slice(0, 2))
})

it('activates only for intranet relay mode and restores the original Python search path', async () => {
  const original = process.env.PYTHONPATH
  const route = new ResourceRouting('http://platform.lan', undefined, undefined, { indexes, attemptSeconds: 5 })
  cleanups.push(() => route.dispose())
  route.configure('intranet', { source: 'proxy', proxyUrl: 'http://relay.lan:3128', autoDetect: false, probeUrls: [] })
  await route.prepare()
  const overlay = process.env.PYTHONPATH!.split(delimiter)[0]!
  expect(existsSync(join(overlay, 'pip', '__main__.py'))).toBe(true)
  expect(process.env.PIP_INDEX_URL).toBe(indexes[0])
  expect(process.env.PIP_EXTRA_INDEX_URL).toBeUndefined()
  route.configure('intranet', { source: 'offline', proxyUrl: '', autoDetect: false, probeUrls: [] })
  expect(process.env.PYTHONPATH).toBe(original)
  expect(process.env.PIP_NO_INDEX).toBe('1')
  route.configure('internet', undefined)
  expect(process.env.PYTHONPATH).toBe(original)
  await route.dispose()
  expect(existsSync(overlay)).toBe(false)
})

it('rejects unsafe mirror URLs before creating an overlay', () => {
  for (const url of ['http://mirror.invalid/simple/', 'https://user:password@mirror.invalid/simple/']) {
    expect(() => new PipMirrors({ indexes: [url], attemptSeconds: 5 })).toThrow()
  }
})
