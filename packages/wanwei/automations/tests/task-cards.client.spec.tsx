// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AutomationCards, type AutomationApi } from '../src/client/task-cards.tsx'
import type { AutomationSnapshot } from '../src/contract.ts'

afterEach(cleanup)
const empty: AutomationSnapshot = { tasks: [], runs: [] }

it('shows no built-in sample tasks when the Host has no data', async () => {
  const api: AutomationApi = { call: vi.fn().mockResolvedValue(empty), openSession: vi.fn() }
  render(<AutomationCards api={api} notify={vi.fn()} />)
  expect(await screen.findByText('尚未配置自动化')).toBeTruthy()
  expect(screen.queryByRole('switch')).toBeNull()
})

it('saves the real task through RPC and does not publish a failed write', async () => {
  const call = vi.fn().mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error('磁盘写入失败'))
  render(<AutomationCards api={{ call, openSession: vi.fn() }} notify={vi.fn()} />)
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
  const api: AutomationApi = { openSession, call: vi.fn().mockResolvedValue({
    tasks: [], runs: [{ id: 'run', taskId: 'task', taskName: '真实任务', status: 'success',
      trigger: 'manual', startedAt: 1, sessionId: 'session' }],
  }) }
  render(<AutomationCards api={api} notify={vi.fn()} />)
  await screen.findByText('尚未配置自动化')
  fireEvent.click(screen.getByText('运行记录'))
  fireEvent.click(screen.getByText('查看会话与产物'))
  expect(openSession).toHaveBeenCalledWith('session')
})
