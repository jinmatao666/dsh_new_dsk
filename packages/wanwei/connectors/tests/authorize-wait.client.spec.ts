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
    })).resolves.toMatchObject({ authed: true })
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('returns when auth and the skill are already present during the flight', async () => {
    const read = vi.fn().mockResolvedValue({
      authorizing: true,
      authorizeError: null,
      authed: true,
      skillInstalled: true,
    })
    await expect(waitForConnectorAuthorization(read, {
      wait: async () => {},
      now: () => 0,
      timeoutMs: 5_000,
    })).resolves.toMatchObject({ authed: true, skillInstalled: true })
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
    })).resolves.toMatchObject({ skillInstalled: true })
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('keeps retrying a dropped poll until the deadline', async () => {
    const read = vi.fn().mockRejectedValue(new Error('Failed to fetch'))
    await expect(waitForConnectorAuthorization(read, {
      wait: async () => {},
      now: () => 0,
      timeoutMs: 0,
    })).rejects.toThrow(/授权等待超时/)
  })
})
