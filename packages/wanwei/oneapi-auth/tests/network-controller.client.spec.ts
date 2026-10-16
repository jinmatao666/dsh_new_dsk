// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { NetworkController } from '../src/client/network-controller.ts'

afterEach(() => { delete (window as unknown as Record<string, unknown>).__ZJUGIS_NATIVE_INVOKE__ })
it('publishes administrator permissions on refresh and retains a denial across network failures', async () => {
  let browserAssistant = false
  const call = vi.fn(async () => ({ ok: true, value: { mode: 'internet', internalOrigins: [], plugins: { browserAssistant } } }))
  const controller = new NetworkController({ rpc: { call } } as unknown as ConnectionHandle)
  const permission = controller.pluginAllowed('browserAssistant')
  const listener = vi.fn()
  const unsubscribe = permission.subscribe(listener)
  expect(permission.getSnapshot()).toBe(false)
  browserAssistant = true
  await controller.refresh()
  expect(permission.getSnapshot()).toBe(true)
  browserAssistant = false
  await controller.refresh()
  expect(permission.getSnapshot()).toBe(false)
  call.mockRejectedValueOnce(new Error('offline'))
  await expect(controller.refresh()).rejects.toThrow('offline')
  expect(permission.getSnapshot()).toBe(false)
  expect(listener).toHaveBeenCalledTimes(2)
  unsubscribe()
})
it('refreshes server-owned mode, synchronizes native policy and retains the last mode on failure', async () => {
  const native = vi.fn(async () => {})
  ;(window as unknown as Record<string, unknown>).__ZJUGIS_NATIVE_INVOKE__ = native
  let saved = 'intranet'
  const call = vi.fn(async (_path: string, operation: string) => {
    expect(operation).toBe('network-get')
    return { ok: true, value: { mode: saved, internalOrigins: ['http://server.lan'] } }
  })
  const controller = new NetworkController({ rpc: { call } } as unknown as ConnectionHandle)
  const listener = vi.fn()
  const unsubscribe = controller.subscribe(listener)
  await controller.refresh()
  expect(controller.getSnapshot().mode).toBe('intranet')
  expect(native).toHaveBeenCalledWith('set_network_environment', { mode: 'intranet', internalOrigins: ['http://server.lan'] })
  saved = 'internet'
  await controller.refresh()
  expect(controller.getSnapshot().mode).toBe('internet')
  expect(listener).toHaveBeenCalledTimes(2)
  call.mockRejectedValueOnce(new Error('保存失败'))
  await expect(controller.refresh()).rejects.toThrow('保存失败')
  expect(controller.getSnapshot().mode).toBe('internet')
  unsubscribe()
  await controller.refresh()
  expect(listener).toHaveBeenCalledTimes(2)
})

it('publishes independent visibility flags only after a successful deployment refresh', async () => {
  const features = { internet: { automations: false, connectors: false }, intranet: { automations: true, connectors: true } }
  let mode = 'internet'
  const call = vi.fn(async () => ({ ok: true, value: { mode, internalOrigins: [], features } }))
  const controller = new NetworkController({ rpc: { call } } as unknown as ConnectionHandle)
  const connectors = controller.visibility('connectors')
  const automations = controller.visibility('automations')
  await controller.refresh()
  expect(connectors.getSnapshot()).toBe(false)
  expect(automations.getSnapshot()).toBe(false)
  mode = 'intranet'
  await controller.refresh()
  expect(connectors.getSnapshot()).toBe(true)
  expect(automations.getSnapshot()).toBe(true)
  call.mockRejectedValueOnce(new Error('offline'))
  await expect(controller.refresh()).rejects.toThrow('offline')
  expect(connectors.getSnapshot()).toBe(true)
})
