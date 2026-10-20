import { describe, expect, it, vi } from 'vitest'
import { waitForConnectorAuthorization } from '../src/client/authorize-wait.ts'

describe('waitForConnectorAuthorization', () => {
  it('returns when authorizing clears', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce({ authorizing: true, authorizeError: null })
      .mockResolvedValueOnce({ authorizing: false, authorizeError: null, authed: true })
    let clock = 0
    await expect(waitForConnectorAuthorization(read, {
      wait: async () => { clock += 1 },
      now: () => clock * 1000,
      timeoutMs: 10_000,
      isVisible: () => true,
    })).resolves.toMatchObject({ authed: true })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('surfaces authorizeError after the flight ends', async () => {
    const read = vi.fn().mockResolvedValue({
      authorizing: false,
      authorizeError: 'cli failed',
    })
    await expect(waitForConnectorAuthorization(read, {
      wait: async () => {},
      now: () => 0,
      timeoutMs: 5_000,
      isVisible: () => true,
    })).rejects.toThrow('cli failed')
  })

  it('retries transport failures while the page is hidden', async () => {
    const read = vi.fn()
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockRejectedValueOnce(new Error('Failed to fetch'))
      .mockResolvedValueOnce({ authorizing: false, authorizeError: null, skillInstalled: true })
    let clock = 0
    await expect(waitForConnectorAuthorization(read, {
      wait: async () => { clock += 1 },
      now: () => clock * 1000,
      timeoutMs: 10_000,
      isVisible: () => false,
      visibleMissLimit: 2,
    })).resolves.toMatchObject({ skillInstalled: true })
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('throws after repeated transport failures while visible', async () => {
    const read = vi.fn().mockRejectedValue(new Error('Failed to fetch'))
    let clock = 0
    await expect(waitForConnectorAuthorization(read, {
      wait: async () => { clock += 1 },
      now: () => clock * 1000,
      timeoutMs: 10_000,
      isVisible: () => true,
      visibleMissLimit: 2,
    })).rejects.toThrow(/Failed to fetch|无法连接本机服务/)
    expect(read).toHaveBeenCalledTimes(2)
  })
})
