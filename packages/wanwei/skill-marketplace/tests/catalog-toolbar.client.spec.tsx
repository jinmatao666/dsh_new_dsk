// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { CatalogToolbar } from '../src/client/CatalogToolbar.tsx'
import { pagePlatformCatalog } from '../src/client/catalog.ts'
import { isMarketInteraction } from '../src/client/market-interaction.ts'

afterEach(cleanup)

describe('catalog-local controls', () => {
  it('treats portaled filter choices as internal interactions while sidebar clicks remain external', () => {
    const closeMarket = vi.fn()
    const onCategory = vi.fn()
    const dismiss = (event: Event) => {
      if (event.target instanceof Element && !isMarketInteraction(event.target)) closeMarket()
    }
    document.addEventListener('pointerdown', dismiss, true)
    try {
      render(<><div className="dsh-skill-market-panel"><CatalogToolbar searchLabel="搜索技能"
        keyword="" onKeyword={vi.fn()} onSearch={vi.fn()} categoryLabel="全部技能"
        categories={[{ key: 'platform', name: '平台技能' }, { key: 'skillhub', name: 'SkillHub技能' }]}
        category="" onCategory={onCategory} page={1} pages={1} onPage={vi.fn()} /></div>
      <button type="button">工作区</button></>)
      for (const [name, value] of [['平台技能', 'platform'], ['SkillHub技能', 'skillhub'], ['全部技能', '']] as const) {
        fireEvent.pointerDown(screen.getByRole('combobox'))
        fireEvent.click(screen.getByRole('combobox'))
        const list = screen.getByRole('listbox')
        expect(list.closest('.dsh-skill-market-panel')).toBeNull()
        fireEvent.pointerDown(list)
        const option = screen.getByRole('option', { name })
        fireEvent.pointerDown(option)
        fireEvent.click(option)
        expect(onCategory).toHaveBeenLastCalledWith(value)
      }
      expect(onCategory).toHaveBeenCalledTimes(3)
      expect(closeMarket).not.toHaveBeenCalled()
      fireEvent.pointerDown(screen.getByRole('button', { name: '工作区' }))
      expect(closeMarket).toHaveBeenCalledOnce()
    } finally { document.removeEventListener('pointerdown', dismiss, true) }
  })
  it('submits search through the input form and keeps pagination alongside filters', () => {
    const onSearch = vi.fn()
    const onPage = vi.fn()
    const view = render(<CatalogToolbar searchLabel="搜索平台技能" keyword="PDF" onKeyword={vi.fn()}
      onSearch={onSearch} categories={[]} category="" onCategory={vi.fn()} sort="downloads" onSort={vi.fn()}
      page={1} pages={2} onPage={onPage} />)
    expect(screen.queryByRole('button', { name: '搜索' })).toBeNull()
    fireEvent.submit(screen.getByRole('textbox', { name: '搜索平台技能' }).closest('form')!)
    expect(onSearch).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '上一页' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(onPage).toHaveBeenCalledWith(2)
    expect(view.container.querySelector('.dsh-skill-catalog-toolbar')?.contains(screen.getByText('第1 页 / 2'))).toBe(true)
  })

  it('offers direct page selection and a validated jump without changing the market scroll position', () => {
    const onPage = vi.fn()
    function Harness() {
      const [page, setPage] = useState(6)
      return <div className="dsh-skill-market-panel"><CatalogToolbar searchLabel="搜索平台技能"
        keyword="" onKeyword={vi.fn()} onSearch={vi.fn()} categories={[]} category="" onCategory={vi.fn()}
        page={page} pages={14280} onPage={(value) => {
          document.querySelector<HTMLElement>('.dsh-skill-market-panel')!.scrollTop = 0
          setPage(value)
          onPage(value)
        }} /></div>
    }
    const view = render(<Harness />)
    const panel = view.container.firstElementChild!
    panel.scrollTop = 420
    expect(screen.getByRole('button', { name: '第6 页' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: '第7 页' }))
    expect(onPage).toHaveBeenCalledWith(7)
    expect(panel.scrollTop).toBe(420)
    fireEvent.change(screen.getByRole('textbox', { name: '跳转页码' }), { target: { value: '125' } })
    fireEvent.submit(screen.getByRole('textbox', { name: '跳转页码' }).closest('form')!)
    expect(onPage).toHaveBeenCalledWith(125)
    expect(panel.scrollTop).toBe(420)
    fireEvent.change(screen.getByRole('textbox', { name: '跳转页码' }), { target: { value: '14281' } })
    fireEvent.submit(screen.getByRole('textbox', { name: '跳转页码' }).closest('form')!)
    expect(onPage).toHaveBeenCalledTimes(2)
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
