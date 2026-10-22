import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runDwsTool, validateDwsToolArgs } from '../src/dingtalk-dws-tool.ts'

describe('dingtalk_dws tool', () => {
  it('rejects empty argv and connector-owned auth subcommands', () => {
    expect(() => { validateDwsToolArgs([]) }).toThrow('args 不能为空')
    for (const sub of ['login', 'logout', 'reset', 'export']) {
      expect(() => { validateDwsToolArgs(['auth', sub]) }).toThrow('由钉钉连接器负责')
    }
    expect(() => { validateDwsToolArgs(['auth', 'status', '--format', 'json']) }).not.toThrow()
    expect(() => { validateDwsToolArgs(['chat', '+dm', '--to', '张三', '--content', '你好', '--yes']) }).not.toThrow()
  })

  it('passes argv without a shell and reports output, exit code, and cwd', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), '万维-dws-tool-')))
    const script = 'process.stdout.write(JSON.stringify({ argv: process.argv.slice(1), cwd: process.cwd() })); process.stderr.write("warn"); process.exit(3)'
    const result = await runDwsTool(process.execPath, ['-e', script, '--', '--content', 'a b; echo x'], cwd, new AbortController().signal)
    expect(result.exitCode).toBe(3)
    expect(result.stderr).toBe('warn')
    const reported = JSON.parse(result.stdout) as { argv: string[]; cwd: string }
    expect(reported.argv).toEqual(['--content', 'a b; echo x'])
    expect(realpathSync(reported.cwd)).toBe(cwd)
  })

  it('kills the process when the call is aborted', async () => {
    const controller = new AbortController()
    const running = runDwsTool(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], undefined, controller.signal)
    controller.abort()
    const result = await running
    expect(result.exitCode).not.toBe(0)
  })

  it('rejects when the executable cannot be started', async () => {
    await expect(runDwsTool(join(tmpdir(), 'missing-dws-binary'), ['auth', 'status'], undefined, new AbortController().signal)).rejects.toThrow()
  })
})
