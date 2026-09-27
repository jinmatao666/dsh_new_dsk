// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SkillHubSection } from '../src/client/SkillHubSection.tsx'

afterEach(cleanup)
const skill = { slug: 'remote-pdf', name: 'PDF 助手', summary: '<style>body{display:none}</style>处理 PDF', version: '1.2', author: '作者', category: 'office', paid: false, requiresApiKey: false }
const record = { ...skill, source: 'skillhub', localSlug: 'pdf-helper', sha256: 'hash' }
const page = { items: [skill], total: 13, pageSize: 12 }

describe('SkillHub marketplace workflow', () => {
  it('downloads, installs and uses the actual local name; details cannot inject styles', async () => {
    let records: unknown[] = []
    const request = vi.fn(async (operation: string) => operation === 'categories' ? { items: [] } : operation === 'list' ? page : operation === 'detail' ? skill : { archive: 'zip', slug: skill.slug, version: skill.version, sha256: 'hash' })
    const invoke = vi.fn(async (command: string) => {
      if (command === 'install_skillhub_skill') { records = [record]; return record }
      return records
    })
    const onUse = vi.fn()
    const view = render(<SkillHubSection active installedOnly={false} request={request} invoke={invoke} onUse={onUse} onCount={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: '查看详情' }))
    fireEvent.click(await screen.findByRole('button', { name: '安装' }))
    await screen.findByText('技能已安装，可以开始使用')
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
    fireEvent.click(await screen.findByRole('button', { name: '查看详情' }))
    fireEvent.click(screen.getByRole('button', { name: '卸载' }))
    await screen.findByText('技能已卸载')
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
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    await waitFor(() => { expect(request).toHaveBeenCalledWith('list', expect.objectContaining({ page: 1, keyword: 'pdf' })) })
    request.mockRejectedValue(new Error('网络异常'))
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    expect((await screen.findByRole('alert')).textContent).toContain('网络异常')
  })
})
