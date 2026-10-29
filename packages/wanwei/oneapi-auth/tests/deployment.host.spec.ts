import { afterEach, expect, it, vi } from 'vitest'
import { fetchDeploymentSettings, resolveDeploymentFeatures, resolveDeploymentPlugins } from '../src/deployment.ts'

afterEach(() => vi.unstubAllGlobals())
it.each(['internet', 'intranet'])('reads %s mode and the public maintenance contact from the configured backend', async (network) => {
  const data = { network, operator: '张运维', phone: '0571-12345678' }
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ success: true, data })))
  vi.stubGlobal('fetch', fetcher)
  expect(await fetchDeploymentSettings('https://oneapi.example.test')).toEqual({ ...data,
    internetCatalogPolicy: 'disable', internetSkillPolicy: 'disable', internetExpertPolicy: 'disable',
    features: resolveDeploymentFeatures(undefined), plugins: { browserAssistant: true } })
  expect(fetcher.mock.calls[0]).toEqual(['https://oneapi.example.test/api/desktop-config', { signal: null, cache: 'no-store', redirect: 'error' }])
})

it('accepts explicit administrator denial, allowlists public plugins and rejects invalid settings', () => {
  expect(resolveDeploymentPlugins({ browserAssistant: false, secret: 'hidden' })).toEqual({ browserAssistant: false })
  expect(resolveDeploymentPlugins({ browserAssistant: true })).toEqual({ browserAssistant: true })
  for (const value of [null, {}, { browserAssistant: 'false' }, { browserAssistant: null }]) {
    expect(() => resolveDeploymentPlugins(value)).toThrow('后台插件设置无效')
  }
})

it('keeps the two environments independent and rejects incomplete or non-boolean flags', () => {
  const features = {
    internet: { automations: false, connectors: false, knowledgeBases: true },
    intranet: { automations: true, connectors: true, knowledgeBases: false },
  }
  expect(resolveDeploymentFeatures(features)).toEqual(features)
  for (const value of [null, {}, { ...features, intranet: null },
    { ...features, internet: { automations: 'false', connectors: true, knowledgeBases: true } }]) {
    expect(() => resolveDeploymentFeatures(value)).toThrow('后台功能设置无效')
  }
})
it('defaults only the missing knowledge switch in legacy per-environment settings', () => {
  const legacy = { internet: { automations: false, connectors: true }, intranet: { automations: true, connectors: false } }
  expect(resolveDeploymentFeatures(legacy)).toEqual({
    internet: { ...legacy.internet, knowledgeBases: true }, intranet: { ...legacy.intranet, knowledgeBases: true },
  })
  for (const knowledgeBases of [null, 'true', 1]) {
    expect(() => resolveDeploymentFeatures({ ...legacy, internet: { ...legacy.internet, knowledgeBases } })).toThrow('后台功能设置无效')
  }
  const denied = resolveDeploymentFeatures({ ...legacy, internet: { ...legacy.internet, knowledgeBases: false } })
  expect(denied.internet.knowledgeBases).toBe(false)
})

it('rejects unavailable or invalid configuration without assuming internet mode', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
  await expect(fetchDeploymentSettings('http://server.lan')).rejects.toThrow('无法读取后台系统设置')
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: { network: 'unknown', operator: '', phone: '' } }))))
  await expect(fetchDeploymentSettings('http://server.lan')).rejects.toThrow('后台系统设置字段无效')
})

it('reads split catalog policies, inherits omitted legacy values, and rejects explicit invalid policies', async () => {
  const data: Record<string, unknown> = { network: 'intranet', operator: '', phone: '', internetCatalogPolicy: 'hide' }
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data }))))
  expect(await fetchDeploymentSettings('https://example.test')).toMatchObject({ internetSkillPolicy: 'hide', internetExpertPolicy: 'hide' })
  data.internetExpertPolicy = 'disable'
  expect(await fetchDeploymentSettings('https://example.test')).toMatchObject({ internetSkillPolicy: 'hide', internetExpertPolicy: 'disable' })
  data.internetExpertPolicy = null
  await expect(fetchDeploymentSettings('https://example.test')).rejects.toThrow()
})
