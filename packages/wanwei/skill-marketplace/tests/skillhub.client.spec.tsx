// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import type { SkillHubSectionProps } from '../src/client/SkillHubSection.tsx'
import { SkillHubSection as CatalogSection } from '../src/client/SkillHubSection.tsx'
import { Toast, type WanweiNotice } from '../src/client/Toast.tsx'

function SkillHubSection(props: Omit<SkillHubSectionProps, 'onNotice'>) {
  const [notice, setNotice] = useState<WanweiNotice | null>(null)
  return <><CatalogSection {...props} onNotice={setNotice} /><Toast notice={notice} setNotice={setNotice} /></>
}

afterEach(cleanup)
const skill = { slug: 'remote-pdf', name: 'PDF 助手', summary: '<style>body{display:none}</style>处理 PDF', version: '1.2', author: '作者', category: 'office', paid: false, requiresApiKey: false }
const record = { ...skill, source: 'skillhub', localSlug: 'pdf-helper', sha256: 'hash' }
const page = { items: [skill], total: 13, pageSize: 12 }

describe('SkillHub marketplace workflow', () => {
  it('never carries uninstalled remote cards into my installations after browsing duplicate slugs', async () => {
    const repeated = { ...skill, slug: 'dev-expert', name: '编程专家.Skill' }
    const request = vi.fn(async (operation: string) => operation === 'categories' ? { items: [] }
      : { items: [repeated, { ...repeated, downloads: 42 }, skill], total: 24, pageSize: 12 })
    const invoke = vi.fn(async () => [])
    const props = { active: true, request, invoke, onUse: () => {}, onCount: () => {} }
    const view = render(<SkillHubSection {...props} installedOnly={false} />)
    await waitFor(() => { expect(view.container.querySelectorAll('.wanwei-skillhub-card')).toHaveLength(3) })
    fireEvent.click(view.getByRole('button', { name: '下一页' }))
    await waitFor(() => { expect(request).toHaveBeenCalledWith('list', expect.objectContaining({ page: 2 })) })
    view.rerender(<SkillHubSection {...props} installedOnly installedPlatforms={[]} />)
    await waitFor(() => { expect(view.container.querySelectorAll('.wanwei-skillhub-card')).toHaveLength(0) })
    expect(view.queryByText('编程专家.Skill')).toBeNull()
    expect(view.getByText('没有匹配的技能')).toBeTruthy()
  })
  it('opens details immediately without a list hint and ignores a response after returning', async () => {
    let finishDetail: (value: unknown) => void = () => {}
    const detail = new Promise<unknown>((resolve) => { finishDetail = resolve })
    const request = vi.fn(async (operation: string) => operation === 'categories'
      ? { items: [] } : operation === 'detail' ? detail : page)
    render(<SkillHubSection active installedOnly={false} request={request}
      invoke={async () => []} onUse={() => {}} onCount={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /PDF 助手/ }))
    expect(screen.getByRole('region', { name: skill.name })).toBeTruthy()
    expect(screen.queryByText('正在读取技能详情…')).toBeNull()
    expect(screen.getByRole('button', { name: '安装' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    finishDetail({ ...skill, name: '迟到的详情' })
    await waitFor(() => { expect(screen.queryByRole('region', { name: '迟到的详情' })).toBeNull() })
    expect(screen.queryByRole('button', { name: '返回' })).toBeNull()
  })
  it('replaces every card across pages even when upstream slugs repeat', async () => {
    const request = vi.fn(async (operation: string, payload: unknown) => {
      if (operation === 'categories') return { items: [] }
      const current = (payload as { page: number }).page
      const items = Array.from({ length: 13 }, (_, index) => ({ ...skill,
        slug: current <= 2 && index < 2 ? 'duplicate' : `page-${current}-${index}`,
        name: `页面 ${current} 技能 ${index}`,
      }))
      return { items, total: 120, pageSize: 12 }
    })
    const view = render(<SkillHubSection active installedOnly={false} request={request}
      invoke={async () => []} onUse={() => {}} onCount={() => {}} />)
    for (const current of [1, 2, 3]) {
      await screen.findByText(`页面 ${current} 技能 11`)
      const cards = view.container.querySelectorAll('.wanwei-skillhub-card')
      expect(cards).toHaveLength(12)
      expect([...cards].every(card => card.textContent?.includes(`页面 ${current} 技能`))).toBe(true)
      expect(screen.queryByText(`页面 ${current} 技能 12`)).toBeNull()
      if (current < 3) fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    }
  })
  it('shows installation success before a slow receipt refresh finishes', async () => {
    let installed = false
    let finishRefresh: (value: unknown[]) => void = () => {}
    const refresh = new Promise<unknown[]>((resolve) => { finishRefresh = resolve })
    const request = vi.fn(async (operation: string) => operation === 'categories' ? { items: [] }
      : operation === 'list' ? page : operation === 'detail' ? skill
        : { archive: 'zip', slug: skill.slug, version: skill.version, sha256: 'hash' })
    const invoke = vi.fn(async (command: string) => {
      if (command === 'install_skillhub_skill') { installed = true; return record }
      return installed ? refresh : []
    })
    render(<SkillHubSection active installedOnly={false} request={request} invoke={invoke} onUse={() => {}} onCount={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /PDF 助手/ }))
    fireEvent.click(await screen.findByRole('button', { name: '安装' }))
    expect((await screen.findByText('安装成功')).closest('[data-wanwei-notice]')).not.toBeNull()
    finishRefresh([record])
    await waitFor(() => { expect(screen.getByRole('button', { name: '卸载' }).hasAttribute('disabled')).toBe(false) })
  })

  it.each(['install', 'uninstall'] as const)('shows a visible error when %s fails', async (action) => {
    const request = vi.fn(async (operation: string) => operation === 'categories' ? { items: [] }
      : operation === 'list' ? page : operation === 'detail' ? skill
        : { archive: 'zip', slug: skill.slug, version: skill.version, sha256: 'hash' })
    const invoke = vi.fn(async (command: string) => {
      if (command === 'list_skillhub_skills') return action === 'uninstall' ? [record] : []
      throw new Error('文件操作失败')
    })
    render(<SkillHubSection active installedOnly={false} request={request} invoke={invoke} onUse={() => {}} onCount={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /PDF 助手/ }))
    fireEvent.click(await screen.findByRole('button', { name: action === 'install' ? '安装' : '卸载' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('文件操作失败')
    expect(alert.hasAttribute('data-wanwei-notice')).toBe(true)
    expect(screen.queryByText(action === 'install' ? '安装成功' : '卸载成功')).toBeNull()
  })

  it('combines installations into twelve-card pages with source selection and scoped search', async () => {
    const platforms = Array.from({ length: 13 }, (_, index) => ({
      id: `p-${index}`, slug: `p-${index}`, name: `平台 ${index}`, summary: '',
      searchText: `平台 ${index}`, card: <article key={`p-${index}`} data-platform>{`平台 ${index}`}</article>,
    }))
    const request = vi.fn(async () => { throw new Error('offline') })
    const view = render(<SkillHubSection active installedOnly installedPlatforms={platforms} request={request}
      invoke={async () => [record]} onUse={() => {}} onCount={() => {}} />)
    await waitFor(() => { expect(screen.getByText('第1 页 / 2')).toBeTruthy() })
    expect(view.container.querySelector('.dsh-skill-grid')?.children).toHaveLength(12)
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByText('平台 12')).toBeTruthy()
    expect(await screen.findByRole('button', { name: /PDF 助手/ })).toBeTruthy()
    expect(view.container.querySelector('.dsh-skill-grid')?.children).toHaveLength(2)
    fireEvent.click(screen.getByRole('combobox', { name: '搜索技能 / 全部技能' }))
    fireEvent.click(screen.getByRole('option', { name: 'SkillHub技能' }))
    expect(screen.getByText('第1 页 / 1')).toBeTruthy()
    expect(view.container.querySelectorAll('[data-platform]')).toHaveLength(0)
    fireEvent.click(screen.getByRole('combobox', { name: '搜索技能 / 全部技能' }))
    fireEvent.click(screen.getByRole('option', { name: '平台技能' }))
    expect(view.container.querySelectorAll('[data-platform]')).toHaveLength(12)
    fireEvent.change(screen.getByLabelText('搜索技能'), { target: { value: '平台 12' } })
    fireEvent.submit(screen.getByLabelText('搜索技能').closest('form')!)
    expect(view.container.querySelector('.dsh-skill-grid')?.children).toHaveLength(1)
    expect(screen.getByText('平台 12')).toBeTruthy()
    expect(screen.getByRole('button', { name: '下一页' }).hasAttribute('disabled')).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })

  it('clamps the unified page after uninstalling its last receipt', async () => {
    const platforms = Array.from({ length: 12 }, (_, index) => ({
      id: `p-${index}`, slug: `p-${index}`, name: `平台 ${index}`, summary: '',
      searchText: `平台 ${index}`, card: <article key={`p-${index}`}>{`平台 ${index}`}</article>,
    }))
    let records = [record]
    const invoke = vi.fn(async (command: string) => { if (command === 'uninstall_skillhub_skill') records = []; return records })
    render(<SkillHubSection active installedOnly installedPlatforms={platforms} request={vi.fn()}
      invoke={invoke} onUse={() => {}} onCount={() => {}} />)
    await waitFor(() => { expect(screen.getByText('第1 页 / 2')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    fireEvent.click(screen.getByRole('button', { name: /PDF 助手/ }))
    fireEvent.click(screen.getByRole('button', { name: '卸载' }))
    await screen.findByText('卸载成功')
    expect(screen.getByText('第1 页 / 1')).toBeTruthy()
    expect(screen.getByText('平台 0')).toBeTruthy()
  })

  it('shows one card for the same installed skill from both sources and keeps the other installation after removal', async () => {
    const platform = {
      id: 'published-pdf', slug: 'published-pdf', name: skill.name, summary: skill.summary,
      searchText: skill.name, card: <article data-platform>{skill.name}</article>,
    }
    let records = [record]
    const invoke = vi.fn(async (command: string) => {
      if (command === 'uninstall_skillhub_skill') records = []
      return records
    })
    const view = render(<SkillHubSection active installedOnly installedPlatforms={[platform]}
      request={vi.fn()} invoke={invoke} onUse={() => {}} onCount={() => {}} />)
    await screen.findByRole('button', { name: /PDF 助手/ })
    expect(view.container.querySelector('.dsh-skill-grid')?.children).toHaveLength(1)
    expect(view.container.querySelector('[data-platform]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /PDF 助手/ }))
    fireEvent.click(screen.getByRole('button', { name: '卸载' }))
    await screen.findByText('卸载成功')
    expect(view.container.querySelectorAll('[data-platform]')).toHaveLength(1)
    expect(screen.queryByText('没有匹配的技能')).toBeNull()
    view.rerender(<SkillHubSection active installedOnly installedPlatforms={[]}
      request={vi.fn()} invoke={invoke} onUse={() => {}} onCount={() => {}} />)
    expect(view.container.querySelector('.dsh-skill-grid')?.children).toHaveLength(0)
    expect(screen.getByText('没有匹配的技能')).toBeTruthy()
  })

  it('keeps twelve remote cards and local page controls, without source badges', async () => {
    const items = Array.from({ length: 12 }, (_, index) => ({ ...skill, slug: `skill-${index}`, name: `技能 ${index}`, downloads: index }))
    const request = vi.fn(async (operation: string) => operation === 'categories'
      ? { items: [] } : { items, total: 24, pageSize: 12 })
    const view = render(<SkillHubSection active installedOnly={false} request={request}
      invoke={async () => []} onUse={() => {}} onCount={() => {}} />)
    await screen.findByRole('button', { name: /技能 11/ })
    expect(view.container.querySelectorAll('.wanwei-skillhub-card')).toHaveLength(12)
    expect(view.container.querySelector('.wanwei-skillhub-card .dsh-skill-source')).toBeNull()
    expect(view.container.querySelector('.wanwei-skillhub-card small svg')).not.toBeNull()
    expect(screen.getByRole('button', { name: '下一页' }).closest('.dsh-skill-catalog-toolbar')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '搜索' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => { expect(request).toHaveBeenCalledWith('list', expect.objectContaining({ page: 2 })) })
    fireEvent.click(screen.getByRole('combobox', { name: '搜索 SkillHub 技能 / 热门下载' }))
    fireEvent.click(screen.getByRole('option', { name: '最近更新' }))
    await waitFor(() => { expect(request).toHaveBeenCalledWith('list', expect.objectContaining({ page: 1, sort: 'updated_at' })) })
  })
  it('requests the chosen SkillHub page directly', async () => {
    const request = vi.fn(async (operation: string) => operation === 'categories' ? { items: [] }
      : { items: [skill], total: 173064, pageSize: 12 })
    render(<SkillHubSection active installedOnly={false} request={request}
      invoke={async () => []} onUse={() => {}} onCount={() => {}} />)
    await screen.findByRole('button', { name: /PDF 助手/ })
    fireEvent.change(screen.getByRole('textbox', { name: '跳转页码' }), { target: { value: '13000' } })
    fireEvent.submit(screen.getByRole('textbox', { name: '跳转页码' }).closest('form')!)
    await waitFor(() => { expect(request).toHaveBeenCalledWith('list', expect.objectContaining({ page: 13000 })) })
    await screen.findByText('第13000 页 / 14422')
    expect(screen.getByRole('button', { name: '第13000 页' }).getAttribute('aria-current')).toBe('page')
  })
  it('keeps the previous grid in place while the next SkillHub page loads', async () => {
    let finishPage: (value: unknown) => void = () => {}
    const nextPage = new Promise<unknown>((resolve) => { finishPage = resolve })
    const request = vi.fn(async (operation: string, payload: unknown) => {
      if (operation === 'categories') return { items: [] }
      if (operation === 'list') return (payload as { page: number }).page === 1
        ? { items: [skill], total: 24, pageSize: 12 } : nextPage
      return skill
    })
    const view = render(<div className="dsh-skill-market-panel"><SkillHubSection active installedOnly={false}
      request={request} invoke={async () => []} onUse={() => {}} onCount={() => {}} /></div>)
    await screen.findByRole('button', { name: /PDF 助手/ })
    const panel = view.container.firstElementChild as HTMLElement
    panel.scrollTop = 420
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await screen.findByText('正在加载 SkillHub 技能…')
    expect(screen.getByRole('button', { name: /PDF 助手/ })).toBeTruthy()
    expect(panel.scrollTop).toBe(420)
    finishPage({ items: [{ ...skill, slug: 'next-pdf', name: '下一页技能' }], total: 24, pageSize: 12 })
    await screen.findByRole('button', { name: /下一页技能/ })
    expect(panel.scrollTop).toBe(420)
  })
  it('downloads, installs and uses the actual local name; details cannot inject styles', async () => {
    let records: unknown[] = []
    const request = vi.fn(async (operation: string) => operation === 'categories' ? { items: [] } : operation === 'list' ? page : operation === 'detail' ? skill : { archive: 'zip', slug: skill.slug, version: skill.version, sha256: 'hash' })
    const invoke = vi.fn(async (command: string) => {
      if (command === 'install_skillhub_skill') { records = [record]; return record }
      return records
    })
    const onUse = vi.fn()
    const view = render(<SkillHubSection active installedOnly={false} request={request} invoke={invoke} onUse={onUse} onCount={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /PDF 助手/ }))
    fireEvent.click(await screen.findByRole('button', { name: '安装' }))
    await screen.findByText('安装成功')
    expect(screen.queryByText(/已安装 v/)).toBeNull()
    const use = screen.getByRole('button', { name: '使用技能' })
    expect(use.closest('.dsh-skill-detail-header')).not.toBeNull()
    expect(use.parentElement?.contains(screen.getByRole('button', { name: '卸载' }))).toBe(true)
    expect(screen.getByRole('button', { name: '返回' }).querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('status').hasAttribute('data-wanwei-notice')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '关闭提示' }))
    expect(screen.getByRole('region', { name: skill.name })).toBeTruthy()
    expect(invoke).toHaveBeenCalledWith('install_skillhub_skill', expect.objectContaining({ archive: 'zip', record: expect.objectContaining({ slug: 'remote-pdf', version: '1.2' }) as unknown }))
    expect(view.container.querySelector('style')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '使用技能' }))
    expect(onUse).toHaveBeenCalledWith('pdf-helper', 'PDF 助手')
  })
  it('lists and uninstalls local receipts with no network in installed mode', async () => {
    let records = [record]
    const invoke = vi.fn(async (command: string) => { if (command === 'uninstall_skillhub_skill') records = []; return records })
    const request = vi.fn(async () => { throw new Error('offline') })
    render(<SkillHubSection active installedOnly request={request} invoke={invoke} onUse={() => {}} onCount={() => {}} />)
    const badge = await screen.findByText('已安装')
    expect(badge.previousElementSibling?.classList.contains('dsh-skill-card-icon')).toBe(true)
    fireEvent.click(await screen.findByRole('button', { name: /PDF 助手/ }))
    fireEvent.click(screen.getByRole('button', { name: '卸载' }))
    await screen.findByText('卸载成功')
    expect(screen.queryByText('已安装')).toBeNull()
    expect(request).not.toHaveBeenCalled()
    expect(invoke).toHaveBeenCalledWith('uninstall_skillhub_skill', { slug: 'remote-pdf', localSlug: 'pdf-helper' })
  })
  it('keeps search scoped, paginates and renders upstream failures with retry', async () => {
    const request = vi.fn(async (operation: string) => operation === 'categories' ? { items: [] } : page)
    render(<SkillHubSection active installedOnly={false} request={request} invoke={async () => []} onUse={() => {}} onCount={() => {}} />)
    await screen.findByRole('button', { name: '下一页' })
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => { expect(request).toHaveBeenCalledWith('list', expect.objectContaining({ page: 2 })) })
    fireEvent.change(screen.getByLabelText('搜索 SkillHub 技能'), { target: { value: 'pdf' } })
    fireEvent.submit(screen.getByLabelText('搜索 SkillHub 技能').closest('form')!)
    await waitFor(() => { expect(request).toHaveBeenCalledWith('list', expect.objectContaining({ page: 1, keyword: 'pdf' })) })
    request.mockRejectedValue(new Error('网络异常'))
    fireEvent.submit(screen.getByLabelText('搜索 SkillHub 技能').closest('form')!)
    expect((await screen.findByRole('alert')).textContent).toContain('网络异常')
  })
  it('updates the owned receipt and preserves pagination, search and scroll on return', async () => {
    let records = [{ ...record, version: '1.0' }]
    const request = vi.fn(async (operation: string) => operation === 'categories' ? { items: [] } : operation === 'list' ? page : operation === 'detail' ? skill : { archive: 'zip', slug: skill.slug, version: skill.version, sha256: 'hash' })
    const invoke = vi.fn(async (command: string) => {
      if (command === 'install_skillhub_skill') { records = [record]; return record }
      return records
    })
    const view = render(<div className="dsh-skill-market-panel"><SkillHubSection active installedOnly={false} request={request} invoke={invoke} onUse={() => {}} onCount={() => {}} /></div>)
    fireEvent.click(await screen.findByRole('button', { name: '下一页' }))
    await waitFor(() => { expect(request).toHaveBeenCalledWith('list', expect.objectContaining({ page: 2 })) })
    const panel = view.container.firstElementChild as HTMLElement
    panel.scrollTop = 420
    fireEvent.click(await screen.findByRole('button', { name: /PDF 助手/ }))
    fireEvent.click(await screen.findByRole('button', { name: '更新技能' }))
    await screen.findByText('更新成功')
    expect(invoke).toHaveBeenCalledWith('install_skillhub_skill', expect.objectContaining({ record: expect.objectContaining({ localSlug: 'pdf-helper', version: '1.2' }) as unknown }))
    fireEvent.click(screen.getByRole('button', { name: '返回' }))
    await waitFor(() => { expect(panel.scrollTop).toBe(420) })
    expect(screen.getByText('第2 页 / 2')).toBeTruthy()
  })
})
