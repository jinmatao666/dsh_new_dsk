// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AutomationCards } from '../src/client/task-cards.tsx'

afterEach(cleanup)

describe('desktop automation cards', () => {
  it('toggles a task independently and filters paused cards', () => {
    render(<AutomationCards notify={vi.fn()} />)
    const toggle = screen.getByRole('switch', { name: '启用任务 项目周报汇总' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '已暂停 (2)' }))
    expect(screen.queryByRole('button', { name: '会议纪要待办整理' })).toBeNull()
    expect(screen.getByRole('button', { name: '项目周报汇总' })).toBeTruthy()
  })

  it('edits the mounted demo without creating fake execution records', () => {
    const notify = vi.fn()
    render(<AutomationCards notify={notify} />)
    fireEvent.click(screen.getByRole('button', { name: '项目周报汇总' }))
    fireEvent.change(screen.getByRole('textbox', { name: '任务名称' }), { target: { value: '客户周报' } })
    fireEvent.click(screen.getByRole('button', { name: '保存任务' }))
    expect(screen.getByRole('button', { name: '客户周报' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(notify).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '运行记录' }))
    expect(screen.getByRole('heading', { name: '暂无真实运行记录' })).toBeTruthy()
  })

  it('pauses selected tasks and resets the demo when remounted', () => {
    const view = render(<AutomationCards notify={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '批量管理' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '全选当前任务' }))
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    expect(screen.getAllByRole('switch').every(toggle => toggle.getAttribute('aria-checked') === 'false')).toBe(true)
    view.unmount()
    render(<AutomationCards notify={vi.fn()} />)
    expect(screen.getByRole('button', { name: '已启用 (2)' })).toBeTruthy()
  })
})
