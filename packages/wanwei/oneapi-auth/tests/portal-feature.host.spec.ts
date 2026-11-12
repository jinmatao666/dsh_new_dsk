import { describe, expect, it, vi } from 'vitest'
import { launchDesktopPortal } from '../src/portal-feature.ts'

describe('desktop portal launch', () => {
  it.each([
    ['land-market', 'https://land.example/#/home'],
    ['planning-lecture', 'https://lecture.example/#/home'],
  ] as const)('requests %s launch with the host bearer token', async (portal, url) => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      success: true,
      url,
      ticket: 'a'.repeat(64),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(launchDesktopPortal('https://oneapi.test/', 'user-token', portal)).resolves.toEqual({
      url,
      ticket: 'a'.repeat(64),
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `https://oneapi.test/api/portal/${portal}/launch`,
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: 'Bearer user-token' },
      }),
    )
  })
})
