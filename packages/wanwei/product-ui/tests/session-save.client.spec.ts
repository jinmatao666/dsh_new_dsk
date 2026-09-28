// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ClientPlatformActionProvider } from '@deepseek-ai/dsh-client-platform-actions/client'
import { apply } from '../src/client/product.tsx'

const desktopWindow = window as Window & { __ZJUGIS_NATIVE_INVOKE__?: (command: string, args?: unknown) => Promise<unknown> }
afterEach(() => { delete desktopWindow.__ZJUGIS_NATIVE_INVOKE__ })

function provider(): ClientPlatformActionProvider {
  let result!: ClientPlatformActionProvider
  const services = {
    platformActions: { register: (value: ClientPlatformActionProvider) => { result = value; return () => {} } },
    deliverableExtensions: { registerDetector: () => () => {}, registerPresenter: () => () => {} },
  }
  apply({
    get: (name: keyof typeof services) => services[name],
    effect: (callback: () => unknown) => callback(),
    slots: { inject: () => {} },
  } as unknown as Context)
  return result
}

describe('desktop Session archive saving', () => {
  it('reveals only the actual path after persistence completes', async () => {
    const pending = Promise.withResolvers<unknown>()
    const invoke = vi.fn((command: string) => command === 'save_session_log_archive' ? pending.promise : Promise.resolve())
    desktopWindow.__ZJUGIS_NATIVE_INVOKE__ = invoke
    const save = provider().saveFile!({ filename: 'session.zip', bytes: new Uint8Array([1, 2]) })
    expect(invoke).toHaveBeenCalledTimes(1)
    pending.resolve('C:/Downloads/session-1.zip')
    await expect(save).resolves.toEqual({ path: 'C:/Downloads/session-1.zip' })
    expect(invoke).toHaveBeenLastCalledWith('reveal_downloaded_file', { filePath: 'C:/Downloads/session-1.zip' })
  })

  it('retains the saved path if revealing fails, but never reveals after a failed save', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'save_session_log_archive') return 'C:/Downloads/session.zip'
      throw new Error('Cannot open folder')
    })
    desktopWindow.__ZJUGIS_NATIVE_INVOKE__ = invoke
    await expect(provider().saveFile!({ filename: 'session.zip', bytes: new Uint8Array() })).resolves.toEqual({ path: 'C:/Downloads/session.zip', warning: '文件已保存，但无法打开目录：Cannot open folder' })
    invoke.mockRejectedValue(new Error('Disk full'))
    invoke.mockClear()
    await expect(provider().saveFile!({ filename: 'session.zip', bytes: new Uint8Array() })).rejects.toThrow('Disk full')
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
