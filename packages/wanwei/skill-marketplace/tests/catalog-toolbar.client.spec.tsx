// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CatalogToolbar } from '../src/client/CatalogToolbar.tsx'
import { pagePlatformCatalog } from '../src/client/catalog.ts'

afterEach(cleanup)

describe('catalog-local controls', () => {
  it('submits search through the input form and keeps pagination alongside filters', () => {
    const onSearch = vi.fn()
    const onPage = vi.fn()
    const view = render(<CatalogToolbar searchLabel="搜索平台技能" keyword="PDF" onKeyword={vi.fn()}
      onSearch={onSearch} categories={[]} category="" onCategory={vi.fn()} sort="downloads" onSort={vi.fn()}
      page={1} pages={2} onPage={onPage} />)
    expect(screen.queryByRole('button', { name: '搜索' })).toBeNull()
    fireEvent.submit(screen.getByRole('textbox').closest('form')!)
    expect(onSearch).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '上一页' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(onPage).toHaveBeenCalledWith(2)
    expect(view.container.querySelector('form')?.contains(screen.getByText('第1 页 / 2'))).toBe(true)
  })

  it('pages twelve platform skills without mutating the source or displaying the next page', () => {
    const skills = Array.from({ length: 25 }, (_, index) => ({ id: index, installs: String(index) }))
    const first = pagePlatformCatalog(skills, 'downloads', 1)
    const next = pagePlatformCatalog(skills, 'downloads', 2)
    expect(first.items.map(item => item.id)).toEqual([24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13])
    expect(next.items).toHaveLength(12)
    expect(next.items[0]?.id).toBe(12)
    expect(pagePlatformCatalog(skills, 'downloads', 99)).toMatchObject({ page: 3, pages: 3, items: [skills[0]] })
    expect(skills[0]?.id).toBe(0)
    expect(pagePlatformCatalog([], 'downloads', 1)).toEqual({ page: 1, pages: 1, items: [] })
  })

  it('sorts real update times consistently across ISO strings, seconds and milliseconds', () => {
    const skills = [
      { installs: '9' }, { installs: '1', updatedAt: '2026-09-27T00:00:00Z' },
      { installs: '2', updatedAt: Date.parse('2026-09-28T00:00:00Z') / 1000 },
      { installs: '3', updatedAt: Date.parse('2026-09-29T00:00:00Z') },
    ]
    expect(pagePlatformCatalog(skills, 'updated_at', 1).items.map(item => item.installs)).toEqual(['3', '2', '1', '9'])
  })
})
