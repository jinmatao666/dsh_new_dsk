// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ExpertDetailDialog } from '../src/client/ExpertDetailDialog.tsx'

afterEach(cleanup)

const expert = {
  name: '会议纪要专家',
  role: '录音转写与结构化纪要',
  summary: '提交录音和文字材料，生成 Word 会议纪要。',
  icon: 'meeting',
  scenario: '适用于例会与项目讨论。',
  materials: '提供录音或文字材料。',
  tags: ['录音转写', '会议纪要'],
}

describe('independent expert detail dialog', () => {
  it('restores the four-card presentation while keeping the launch action', () => {
    const onStart = vi.fn()
    const onClose = vi.fn()
    const view = render(<ExpertDetailDialog expert={expert} launching={false} launchError={null} onStart={onStart} onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: '会议纪要专家详情' })).toBeTruthy()
    expect(view.container.querySelectorAll('section[role="dialog"] section')).toHaveLength(4)
    expect(screen.getByRole('heading', { name: '适用场景' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '需要准备的材料' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '本专家交付' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '处理原则' })).toBeTruthy()
    expect([...view.container.querySelectorAll('section[role="dialog"] section img')].map(image => image.getAttribute('src'))).toEqual([
      '/expert-icons/home.png', '/expert-icons/files.png', '/expert-icons/result.png', '/expert-icons/layers.png',
    ])
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }))
    expect(onStart).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('uses administrator-configured sections without duplicating fallback metadata', () => {
    render(<ExpertDetailDialog expert={{ ...expert, detailSections: [
      { title: '交付说明', subtitle: '实际成果', content: 'Word 报告\nExcel 明细' },
    ] }} launching={false} launchError={null} onStart={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '交付说明' })).toBeTruthy()
    expect(screen.getByText('Word 报告')).toBeTruthy()
    expect(screen.getByText('Excel 明细')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '适用场景' })).toBeNull()
  })

  it('shows the configured footer note and keeps launch errors visible', () => {
    const configured = { ...expert, footerNote: '录音转写后生成正式纪要' }
    const view = render(<ExpertDetailDialog expert={configured} launching={false} launchError={null} onStart={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('录音转写后生成正式纪要')).toBeTruthy()
    view.rerender(<ExpertDetailDialog expert={configured} launching={false} launchError="无法打开工作台" onStart={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toBe('无法打开工作台')
  })
})
