import { describe, expect, it, vi } from 'vitest'
import type { ConnectionHandle, RpcResult } from '@deepseek-ai/dsh-client-connection/client'
import {
  connectorRpcError,
  createDingTalkApi,
  parseDingTalkStatus,
  rpcValue,
} from '../src/client/dingtalk-api.ts'

describe('dingtalk-api client helpers', () => {
  it('unwraps RPC results', () => {
    expect(rpcValue({ ok: true, value: 1 })).toBe(1)
    expect(() => rpcValue({ ok: false, error: { code: 'x', message: 'nope', details: {} } } as RpcResult<unknown>))
      .toThrow('nope')
  })

  it('maps browser Failed to fetch to product copy', () => {
    expect(connectorRpcError(new Error('Failed to fetch')).message).toMatch(/无法连接本机服务/)
    expect(connectorRpcError(new Error('未找到随包 dws-cli')).message).toBe('未找到随包 dws-cli')
    expect(connectorRpcError(new Error('无法从 GitHub 下载企业微信技能（Failed to fetch）。')).message)
      .toMatch(/GitHub/)
  })

  it('parses DWS status payloads', () => {
    expect(parseDingTalkStatus({
      dwsInstalled: true,
      dwsVersion: '1.2.3',
      authed: true,
      skillInstalled: false,
      hint: 'need skill',
    })).toEqual({
      dwsInstalled: true,
      dwsVersion: '1.2.3',
      authed: true,
      skillInstalled: false,
      hint: 'need skill',
    })
    expect(() => parseDingTalkStatus(null)).toThrow()
    expect(() => parseDingTalkStatus({ dwsInstalled: true })).toThrow()
  })

  it('creates an API over connection.rpc', async () => {
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      if (endpoint === 'status' || endpoint === 'login' || endpoint === 'installSkill' || endpoint === 'disconnect') {
        return {
          ok: true as const,
          value: {
            dwsInstalled: true,
            dwsVersion: '1.0.0',
            authed: endpoint !== 'disconnect',
            skillInstalled: endpoint === 'installSkill' || endpoint === 'login',
            hint: null,
          },
        }
      }
      return { ok: false as const, error: { code: 'x', message: 'bad', details: {} } }
    })
    const api = createDingTalkApi({ rpc: { call } } as unknown as ConnectionHandle)
    await expect(api.status()).resolves.toMatchObject({ dwsInstalled: true, authed: true })
    await expect(api.login()).resolves.toMatchObject({ skillInstalled: true })
    await expect(api.installSkill()).resolves.toMatchObject({ skillInstalled: true })
    await expect(api.disconnect()).resolves.toMatchObject({ authed: false })
  })
})
