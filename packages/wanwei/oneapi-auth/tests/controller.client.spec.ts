import { describe, expect, it, vi } from 'vitest'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { AuthController } from '../src/client/controller.ts'

describe('AuthController', () => {
  it('publishes login and logout while keeping an authenticated view through a transient outage', async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { state: 'logged-out', username: 'wanwei' } })
      .mockResolvedValueOnce({ ok: true, value: { state: 'authenticated', username: 'wanwei', models: ['deepseek-v3'] } })
      .mockResolvedValueOnce({ ok: true, value: { state: 'offline', message: 'network unavailable' } })
      .mockResolvedValueOnce({ ok: true, value: { state: 'logged-out', username: 'wanwei' } })
    const controller = new AuthController({ rpc: { call } } as unknown as ConnectionHandle)
    const listener = vi.fn()
    const dispose = controller.subscribe(listener)

    await controller.refresh()
    expect(controller.getSnapshot()).toEqual({ state: 'logged-out', username: 'wanwei' })
    await controller.login('wanwei', 'secret')
    expect(controller.getSnapshot()).toEqual({
      state: 'authenticated', username: 'wanwei', models: ['deepseek-v3'],
    })
    await controller.refresh()
    expect(controller.getSnapshot().state).toBe('authenticated')
    await controller.logout()
    expect(controller.getSnapshot()).toEqual({ state: 'logged-out', username: 'wanwei' })
    expect(listener).toHaveBeenCalledTimes(3)
    dispose()
  })

  it('turns a transport failure into an offline view only before authentication', () => {
    const controller = new AuthController({ rpc: {} } as unknown as ConnectionHandle)
    controller.fail(new Error('sidecar unavailable'))
    expect(controller.getSnapshot()).toEqual({ state: 'offline', message: 'sidecar unavailable' })
  })

  it('surfaces Host business failures', async () => {
    const connection = {
      rpc: { call: vi.fn(() => Promise.resolve({ ok: false, error: { code: 'internal', message: 'bad credentials', details: {} } })) },
    } as unknown as ConnectionHandle
    await expect(new AuthController(connection).login('wanwei', 'wrong')).rejects.toThrow('bad credentials')
  })
})
