import { describe, expect, it, vi } from 'vitest'
import { launchLandMarket } from '../src/portal-land-market.ts'

describe('portal land market launch helpers', () => {
  it('requests launch with the host bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      success: true,
      url: 'https://land.example/#/home',
      ticket: 'a'.repeat(64),
    }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(launchLandMarket('https://oneapi.test/', 'user-token')).resolves.toEqual({
      url: 'https://land.example/#/home',
      ticket: 'a'.repeat(64),
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://oneapi.test/api/portal/land-market/launch',
      expect.objectContaining({
        method: 'POST',
        headers: { authorization: 'Bearer user-token' },
      }),
    )
  })
})
