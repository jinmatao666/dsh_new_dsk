// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { NetworkController } from '../src/client/network-controller.ts'

afterEach(() => { delete (window as unknown as Record<string, unknown>).__ZJUGIS_NATIVE_INVOKE__ })
it('loads the saved mode, synchronizes native policy and publishes successful switches only', async () => {
  const native = vi.fn(async () => {})
  ;(window as unknown as Record<string, unknown>).__ZJUGIS_NATIVE_INVOKE__ = native
  let saved = 'intranet'
  const call = vi.fn(async (_path: string, operation: string, payload: unknown) => {
    if (operation === 'network-set') saved = (payload as { mode: string }).mode
    return { ok: true, value: { mode: saved, internalOrigins: ['http://server.lan'] } }
  })
  const controller = new NetworkController({ rpc: { call } } as unknown as ConnectionHandle)
  const listener = vi.fn()
  const unsubscribe = controller.subscribe(listener)
  await controller.refresh()
  expect(controller.getSnapshot().mode).toBe('intranet')
  expect(native).toHaveBeenCalledWith('set_network_environment', { mode: 'intranet', internalOrigins: ['http://server.lan'] })
  await controller.setMode('internet')
  expect(controller.getSnapshot().mode).toBe('internet')
  expect(listener).toHaveBeenCalledTimes(2)
  call.mockRejectedValueOnce(new Error('保存失败'))
  await expect(controller.setMode('intranet')).rejects.toThrow('保存失败')
  expect(controller.getSnapshot().mode).toBe('internet')
  unsubscribe()
  await controller.refresh()
  expect(listener).toHaveBeenCalledTimes(2)
})
