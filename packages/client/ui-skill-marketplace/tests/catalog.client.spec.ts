import { describe, expect, it } from 'vitest'
import { buildMarketplaceCatalog } from '../src/client/catalog.ts'

describe('marketplace skill catalog', () => {
  it('shows only local skills while the server catalog is unavailable', () => {
    const local = [{ id: 'local-skill' }]

    expect(buildMarketplaceCatalog(local, null)).toEqual(local)
  })

  it('combines local skills with published server skills', () => {
    const local = [{ id: 'local-skill' }]
    const published = [{ id: 'published-skill' }]

    expect(buildMarketplaceCatalog(local, published)).toEqual([...local, ...published])
  })
})
