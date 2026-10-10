import { afterEach, expect, it, vi } from 'vitest'
import { fetchDeploymentSettings, resolveDeploymentFeatures } from '../src/deployment.ts'

afterEach(() => vi.unstubAllGlobals())
it.each(['internet', 'intranet'])('reads %s mode and the public maintenance contact from the configured backend', async (network) => {
  const data = { network, operator: '张运维', phone: '0571-12345678' }
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true, data })))
  vi.stubGlobal('fetch', fetcher)
  expect(await fetchDeploymentSettings('https://oneapi.example.test')).toEqual({ ...data, features: resolveDeploymentFeatures(undefined) })
  expect(fetcher.mock.calls[0]).toEqual(['https://oneapi.example.test/api/desktop-config', { signal: null, cache: 'no-store', redirect: 'error' }])
})

it('keeps the two environments independent and rejects incomplete or non-boolean flags', () => {
  const features = { internet: { automations: false, connectors: false }, intranet: { automations: true, connectors: true } }
  expect(resolveDeploymentFeatures(features)).toEqual(features)
  for (const value of [null, {}, { ...features, intranet: null }, { ...features, internet: { automations: 'false', connectors: true } }]) {
    expect(() => resolveDeploymentFeatures(value)).toThrow('后台功能设置无效')
  }
})
it('rejects unavailable or invalid configuration without assuming internet mode', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
  await expect(fetchDeploymentSettings('http://server.lan')).rejects.toThrow('无法读取后台系统设置')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: { network: 'unknown', operator: '', phone: '' } }))))
  await expect(fetchDeploymentSettings('http://server.lan')).rejects.toThrow('后台系统设置字段无效')
})
