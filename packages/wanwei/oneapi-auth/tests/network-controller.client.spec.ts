// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { NetworkController } from '../src/client/network-controller.ts'

afterEach(() => { delete (window as unknown as Record<string, unknown>).__ZJUGIS_NATIVE_INVOKE__ })

it('synchronizes the catalog policy and retains it when a malformed refresh is rejected', async () => {
  let internetCatalogPolicy: unknown = 'hide'
  const call = vi.fn(async () => ({ ok: true, value: { mode: 'intranet', internalOrigins: [], directInternet: false, internetCatalogPolicy } }))
  const controller = new NetworkController({ rpc: { call } } as unknown as ConnectionHandle)
  await controller.refresh()
  expect(controller.getSnapshot().internetCatalogPolicy).toBe('hide')
  expect(controller.catalogAccess(controller.getSnapshot(), true)).toBe('hide')
  expect(controller.catalogAccess(controller.getSnapshot(), false)).toBe('available')
  internetCatalogPolicy = 'disable'
  await controller.refresh()
  expect(controller.getSnapshot().internetCatalogPolicy).toBe('disable')
  internetCatalogPolicy = null
  await expect(controller.refresh()).rejects.toThrow('后台技能专家联网处理设置无效')
  expect(controller.getSnapshot().internetCatalogPolicy).toBe('disable')
})

it('publishes direct connectivity for entry policy and rejects malformed probe results', async () => {
  let directInternet: unknown = false
  const call = vi.fn(async () => ({ ok: true, value: { mode: 'intranet', internalOrigins: [], directInternet } }))
  const controller = new NetworkController({ rpc: { call } } as unknown as ConnectionHandle)
  await controller.refresh()
  expect(controller.getSnapshot().directInternet).toBe(false)
  directInternet = true
  await controller.refresh()
  expect(controller.getSnapshot().directInternet).toBe(true)
  expect(controller.catalogAccess(controller.getSnapshot(), true)).toBe('available')
  directInternet = 'true'
  await expect(controller.refresh()).rejects.toThrow('网络检测状态无效')
  expect(controller.getSnapshot().directInternet).toBe(true)
  expect(controller.catalogAccess(controller.getSnapshot(), true)).toBe('available')
})
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
  const features = {
    internet: { automations: false, connectors: false, knowledgeBases: true },
    intranet: { automations: true, connectors: true, knowledgeBases: false },
  }
  let mode = 'internet'
  const call = vi.fn(async () => ({ ok: true, value: { mode, internalOrigins: [], features } }))
  const controller = new NetworkController({ rpc: { call } } as unknown as ConnectionHandle)
  const connectors = controller.visibility('connectors')
  const automations = controller.visibility('automations')
  const knowledgeBases = controller.visibility('knowledgeBases')
  await controller.refresh()
  expect(connectors.getSnapshot()).toBe(false)
  expect(automations.getSnapshot()).toBe(false)
  expect(knowledgeBases.getSnapshot()).toBe(true)
  mode = 'intranet'
  await controller.refresh()
  expect(connectors.getSnapshot()).toBe(true)
  expect(automations.getSnapshot()).toBe(true)
  expect(knowledgeBases.getSnapshot()).toBe(false)
  call.mockRejectedValueOnce(new Error('offline'))
  await expect(controller.refresh()).rejects.toThrow('offline')
  expect(connectors.getSnapshot()).toBe(true)
})
