import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { ClientPlatformActions } from '../src/client/index.ts'

describe('ClientPlatformActions', () => {
  it('is unavailable until a shell provider is registered', async () => {
    const service = new ClientPlatformActions(new Context())

    expect(service.canOpenDirectory()).toBe(false)
    expect(service.canSaveFile()).toBe(false)
    await expect(service.openDirectory('C:\\workspace')).rejects.toThrow('unavailable')
    await expect(service.saveFile({ filename: 'result.zip', bytes: new Uint8Array() })).rejects.toThrow('unavailable')
  })

  it('routes operations to one disposable shell provider', async () => {
    const service = new ClientPlatformActions(new Context())
    const openDirectory = vi.fn(async () => {})
    const saveFile = vi.fn(async () => {})
    const dispose = service.register({ openDirectory, saveFile })

    await service.openDirectory('C:\\workspace')
    await service.saveFile({ filename: 'result.zip', bytes: Uint8Array.of(1, 2) })

    expect(openDirectory).toHaveBeenCalledWith('C:\\workspace')
    expect(saveFile).toHaveBeenCalledWith({ filename: 'result.zip', bytes: Uint8Array.of(1, 2) })
    expect(() => service.register({})).toThrow('already have a provider')
    dispose()
    expect(service.canOpenDirectory()).toBe(false)
  })
})
