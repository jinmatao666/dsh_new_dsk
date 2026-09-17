import { describe, expect, it } from 'vitest'
import { browseMarketplaceCatalog, buildMarketplaceCatalog, buildMarketplaceCategories, publishedSkillCategories } from '../src/client/catalog.ts'

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

  it('keeps private and review-pending local skills out of the public marketplace', () => {
    const pending = { id: 'local-pending', marketplacePublished: false, reviewStatus: 'pending' }
    const privateSkill = { id: 'local-private' }
    const approved = { id: 'remote-approved', marketplacePublished: true }

    expect(browseMarketplaceCatalog<{
      id: string
      marketplacePublished?: boolean
      reviewStatus?: string
    }>([pending, privateSkill, approved])).toEqual([approved])
  })
})

describe('marketplace categories', () => {
  it('uses package relations for a published skill', () => {
    expect(publishedSkillCategories([
      { type_code: 'skill_function', name: '数据处理', status: 1 },
      { type_code: 'skill_package', name: '空间制图', status: 1 },
      { type_code: 'skill_package', name: '已停用', status: 0 },
    ])).toEqual(['空间制图'])
  })

  it('uses only backend-managed categories in backend order', () => {
    expect(buildMarketplaceCategories([{ name: '通用类' }, { name: '空间制图' }]))
      .toEqual(['通用类', '空间制图'])
    expect(buildMarketplaceCategories(null)).toEqual([])
  })
})
