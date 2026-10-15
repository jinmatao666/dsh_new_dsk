// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RunHistory } from '../src/client/run-history.tsx'

afterEach(cleanup)

it('shows missing prerequisites and saved progress without navigating when details are opened', () => {
  const open = vi.fn()
  render(<RunHistory runs={[{ id: 'run', taskId: 'task', taskName: '资料检查', startedAt: 0, endedAt: 10,
    status: 'waiting', trigger: 'manual', sessionId: 'session', error: '缺少必要输入',
    checkpoint: { stage: 'waiting', summary: '工作区没有任务所需的资料', nextSteps: ['补充资料后在原会话继续'],
      files: [], producesFiles: true, updatedAt: 10 } }]} openSession={open} remove={vi.fn()} />)
  expect(screen.getAllByText('待补充').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByText('查看执行进度'))
  expect(screen.getByText('工作区没有任务所需的资料')).toBeTruthy()
  expect(screen.getByText('补充资料后在原会话继续')).toBeTruthy()
  expect(open).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('资料检查'))
  expect(open).toHaveBeenCalledWith('session')
})
