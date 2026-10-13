// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AutomationCards, type AutomationApi } from '../src/client/task-cards.tsx'
import type { AutomationSnapshot } from '../src/contract.ts'
import { startAutomationConversation } from '../src/client/task-draft.ts'

afterEach(cleanup)
const empty: AutomationSnapshot = { tasks: [], runs: [] }

it('opens office templates and selects a draft without saving or running it', async () => {
  const call = vi.fn().mockResolvedValue(empty)
  render(<AutomationCards api={{ call, openSession: vi.fn(), fromTask: vi.fn() }} notify={vi.fn()} />)
  await screen.findByText('尚未配置自动化')
  fireEvent.click(screen.getByLabelText('新建方式'))
  fireEvent.click(screen.getByText(/从模板新建/))
  expect(screen.getByRole('heading', { name: '从模板添加' })).toBeTruthy()
  expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(6)
  fireEvent.click(screen.getByRole('button', { name: /项目周报汇总/ }))
  expect((screen.getByLabelText('任务名称')).value).toBe('项目周报汇总')
  expect((screen.getByLabelText('工作目录')).value).toBe('')
  expect((screen.getByLabelText('保存后启用')).checked).toBe(false)
  expect(call.mock.calls.every(args => args[0] === 'list')).toBe(true)
})

it('routes from-task creation to a staged conversation without sending', async () => {
  const fromTask = vi.fn()
  render(<AutomationCards api={{ call: vi.fn().mockResolvedValue(empty), openSession: vi.fn(), fromTask }} notify={vi.fn()} />)
  await screen.findByText('尚未配置自动化')
  fireEvent.click(screen.getByLabelText('新建方式'))
  fireEvent.click(screen.getByText(/从任务新建/))
  expect(fromTask).toHaveBeenCalledOnce()
  const input = { setStagedDraft: vi.fn() }
  const sessions = { clear: vi.fn() }
  const close = vi.fn()
  startAutomationConversation(input, sessions, close)
  expect(input.setStagedDraft).toHaveBeenCalledWith('帮我创建一个定时任务：')
  expect(sessions.clear).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
})

it('shows no built-in sample tasks when the Host has no data', async () => {
  const api: AutomationApi = { call: vi.fn().mockResolvedValue(empty), openSession: vi.fn(), fromTask: vi.fn() }
  render(<AutomationCards api={api} notify={vi.fn()} />)
  expect(await screen.findByText('尚未配置自动化')).toBeTruthy()
  expect(screen.queryByRole('switch')).toBeNull()
  expect(screen.queryByRole('button', { name: '筛选任务' })).toBeNull()
  expect(screen.queryByText('正式任务需要电脑和 DSH 保持运行；错过的任务不会自动补执行。')).toBeNull()
  expect(screen.getByRole('button', { name: '搜索任务' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '已启用 (0)' })).toBeTruthy()
})

it('places batch actions after the task area and hides them on execution history', async () => {
  const api: AutomationApi = { call: vi.fn().mockResolvedValue(empty), openSession: vi.fn(), fromTask: vi.fn() }
  render(<AutomationCards api={api} notify={vi.fn()} />)
  const emptyState = await screen.findByText('尚未配置自动化')
  fireEvent.click(screen.getByRole('button', { name: '批量管理' }))
  const footer = screen.getByRole('toolbar', { name: '批量管理' })
  expect(footer.tagName).toBe('FOOTER')
  expect(emptyState.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(screen.getByRole('button', { name: '删除' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '运行记录' }))
  expect(screen.queryByRole('toolbar', { name: '批量管理' })).toBeNull()
})

it('saves the real task through RPC and does not publish a failed write', async () => {
  const call = vi.fn().mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error('磁盘写入失败'))
  render(<AutomationCards api={{ call, openSession: vi.fn(), fromTask: vi.fn() }} notify={vi.fn()} />)
  await screen.findByText('尚未配置自动化')
  fireEvent.click(screen.getByText('＋ 新建'))
  fireEvent.change(screen.getByLabelText('任务名称'), { target: { value: '真实任务' } })
  fireEvent.change(screen.getByLabelText('任务说明'), { target: { value: '汇总文件' } })
  fireEvent.change(screen.getByLabelText('工作目录'), { target: { value: 'C:\\work' } })
  fireEvent.click(screen.getByText('保存任务'))
  await waitFor(() => { expect(screen.getAllByText('磁盘写入失败')).toHaveLength(2) })
  expect(call.mock.calls[1]?.[0]).toBe('save')
  expect(call.mock.calls[1]?.[1]).toMatchObject({ task: { name: '真实任务', cwd: 'C:\\work', prompt: '汇总文件' } })
  expect(screen.getByRole('dialog')).toBeTruthy()
})

it('opens the Session associated with an actual Host run record', async () => {
  const openSession = vi.fn()
  const api: AutomationApi = { openSession, fromTask: vi.fn(), call: vi.fn().mockResolvedValue({
    tasks: [], runs: [{ id: 'run', taskId: 'task', taskName: '真实任务', status: 'success',
      trigger: 'manual', startedAt: 1, sessionId: 'session' }],
  }) }
  render(<AutomationCards api={api} notify={vi.fn()} />)
  await screen.findByText('尚未配置自动化')
  fireEvent.click(screen.getByText('运行记录'))
  fireEvent.click(screen.getByText('查看会话与产物'))
  expect(openSession).toHaveBeenCalledWith('session')
})
