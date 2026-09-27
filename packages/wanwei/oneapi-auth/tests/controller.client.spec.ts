import { describe, expect, it, vi } from 'vitest'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { AuthController } from '../src/client/controller.ts'

describe('AuthController', () => {
  it('keeps the newest refresh and resumes refreshing after a failed login', async () => {
    const old = Promise.withResolvers<{ ok: true; value: { state: 'logged-out'; username: string } }>()
    const call = vi.fn().mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ ok: true, value: { state: 'authenticated', username: 'user', models: [] } })
      .mockRejectedValueOnce(new Error('login rejected'))
      .mockResolvedValueOnce({ ok: true, value: { state: 'logged-out', username: 'user' } })
    const controller = new AuthController({ rpc: { call } } as unknown as ConnectionHandle)
    const first = controller.refresh()
    await controller.refresh()
    old.resolve({ ok: true, value: { state: 'logged-out', username: 'user' } })
    await first
    expect(controller.getSnapshot().state).toBe('authenticated')
    await expect(controller.login('user', 'wrong')).rejects.toThrow('login rejected')
    await controller.refresh()
    expect(controller.getSnapshot().state).toBe('logged-out')
  })

  it('does not let old status replies or pending-login refreshes replace a new login', async () => {
    const status = Promise.withResolvers<{ ok: true; value: { state: 'logged-out'; username: string } }>()
    const login = Promise.withResolvers<{ ok: true; value: { state: 'authenticated'; username: string; models: string[] } }>()
    const call = vi.fn().mockReturnValueOnce(status.promise).mockReturnValueOnce(login.promise).mockReturnValueOnce(status.promise)
    const controller = new AuthController({ rpc: { call } } as unknown as ConnectionHandle)
    const firstRefresh = controller.refresh()
    const signingIn = controller.login('user', 'secret')
    const overlappingRefresh = controller.refresh()
    login.resolve({ ok: true, value: { state: 'authenticated', username: 'user', models: [] } })
    await signingIn
    status.resolve({ ok: true, value: { state: 'logged-out', username: 'user' } })
    await Promise.all([firstRefresh, overlappingRefresh])
    expect(controller.getSnapshot().state).toBe('authenticated')
  })

  it('does not restore a login after a newer logout and ignores stale refresh failures', async () => {
    const login = Promise.withResolvers<{ ok: true; value: { state: 'authenticated'; username: string; models: string[] } }>()
    const status = Promise.withResolvers<never>()
    const call = vi.fn().mockReturnValueOnce(status.promise).mockReturnValueOnce(login.promise)
      .mockResolvedValueOnce({ ok: true, value: { state: 'logged-out', username: 'user' } })
    const controller = new AuthController({ rpc: { call } } as unknown as ConnectionHandle)
    const refresh = controller.refresh().catch((error: unknown) => { controller.fail(error) })
    const signingIn = controller.login('user', 'secret')
    await controller.logout()
    login.resolve({ ok: true, value: { state: 'authenticated', username: 'user', models: [] } })
    status.reject(new Error('old connection failed'))
    await Promise.all([refresh, signingIn])
    expect(controller.getSnapshot().state).toBe('logged-out')
  })

  it('ignores a cancelled refresh even if transport returns successfully', async () => {
    const status = Promise.withResolvers<{ ok: true; value: { state: 'logged-out'; username: string } }>()
    const call = vi.fn().mockReturnValue(status.promise)
    const controller = new AuthController({ rpc: { call } } as unknown as ConnectionHandle)
    const abort = new AbortController()
    const refresh = controller.refresh(abort.signal)
    abort.abort()
    status.resolve({ ok: true, value: { state: 'logged-out', username: 'user' } })
    await refresh
    expect(controller.getSnapshot().state).toBe('checking')
  })

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
