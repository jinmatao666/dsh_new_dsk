import { describe, expect, it } from 'vitest'
import {
  browseMarketplaceCatalog,
  buildMarketplaceCatalog,
  buildMarketplaceCategories,
  countPersonalSkillReviews,
  filterPersonalSkillUploads,
  formatNavigationCount,
  publishedSkillCategories,
} from '../src/client/catalog.ts'

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

describe('personal skill uploads', () => {
  const uploads = [
    { id: 'private', visibility: 'private' as const, reviewStatus: 'none' as const },
    { id: 'pending', visibility: 'public' as const, reviewStatus: 'pending' as const },
    { id: 'rejected', visibility: 'public' as const, reviewStatus: 'rejected' as const },
    { id: 'approved', visibility: 'public' as const, reviewStatus: 'approved' as const },
  ]

  it('separates approved public skills from private skills', () => {
    expect(filterPersonalSkillUploads(uploads, 'public').map(skill => skill.id)).toEqual(['approved'])
    expect(filterPersonalSkillUploads(uploads, 'private').map(skill => skill.id)).toEqual(['private'])
  })

  it('keeps public submission history filterable by review status', () => {
    expect(filterPersonalSkillUploads(uploads, 'reviews').map(skill => skill.id))
      .toEqual(['pending', 'rejected', 'approved'])
    expect(filterPersonalSkillUploads(uploads, 'reviews', 'rejected').map(skill => skill.id))
      .toEqual(['rejected'])
  })

  it('counts only public review records for navigation badges', () => {
    expect(countPersonalSkillReviews(uploads)).toEqual({ all: 3, pending: 1, rejected: 1, approved: 1 })
  })

  it('caps compact navigation counts', () => {
    expect(formatNavigationCount(0)).toBe('0')
    expect(formatNavigationCount(99)).toBe('99')
    expect(formatNavigationCount(100)).toBe('99+')
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
