import { describe, expect, it, vi } from 'vitest'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { createWeComApi, parseWeComStatus } from '../src/client/wecom-api.ts'

describe('wecom-api client helpers', () => {
  it('parses wecom-cli status payloads', () => {
    expect(parseWeComStatus({
      cliInstalled: true,
      cliVersion: '1.3.4',
      authed: true,
      skillInstalled: false,
      hint: 'need skill',
      authorizing: true,
      authorizeError: 'x',
    })).toEqual({
      cliInstalled: true,
      cliVersion: '1.3.4',
      authed: true,
      skillInstalled: false,
      hint: 'need skill',
      authorizing: true,
      authorizeError: 'x',
    })
    expect(() => parseWeComStatus(null)).toThrow()
    expect(() => parseWeComStatus({ cliInstalled: true })).toThrow()
  })

  it('creates an API over connection.rpc', async () => {
    const call = vi.fn(async (_channel: string, endpoint: string) => {
      if (endpoint === 'status' || endpoint === 'login' || endpoint === 'installSkill' || endpoint === 'disconnect') {
        return {
          ok: true as const,
          value: {
            cliInstalled: true,
            cliVersion: '1.0.0',
            authed: endpoint !== 'disconnect',
            skillInstalled: endpoint === 'installSkill' || endpoint === 'login',
            hint: null,
          },
        }
      }
      return { ok: false as const, error: { code: 'x', message: 'bad', details: {} } }
    })
    const api = createWeComApi({ rpc: { call } } as unknown as ConnectionHandle)
    await expect(api.status()).resolves.toMatchObject({ cliInstalled: true, authed: true })
    await expect(api.login()).resolves.toMatchObject({ skillInstalled: true })
    await expect(api.installSkill()).resolves.toMatchObject({ skillInstalled: true })
    await expect(api.disconnect()).resolves.toMatchObject({ authed: false })
  })
})
