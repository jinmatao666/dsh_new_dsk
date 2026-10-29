// @vitest-environment jsdom
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TaskEditor } from '../src/client/task-editor.tsx'
import type { AutomationTask } from '../src/contract.ts'
import type { AutomationApi } from '../src/client/task-cards.tsx'
afterEach(cleanup)
it('defaults off, preserves edits through canceled and successful authorization, and saves multiple channels', async () => {
  let saved: AutomationTask | undefined
  const api: AutomationApi = {
    call: vi.fn(), openSession: vi.fn(), fromTask: vi.fn(), chooseDirectory: async () => null,
    listWorkspaces: async () => [], listModels: async () => ({ default: { provider: 'p', model: 'm' }, groups: [], failures: [], routableProviders: ['p'] }),
    listConnectors: async () => [
      { id: 'feishu', name: '飞书', icon: '', connected: false },
      { id: 'dingtalk', name: '钉钉', icon: '', connected: true },
      { id: 'wechat', name: '微信助理', icon: '', connected: false },
    ],
    connectionDialog: (_id, complete) => <div role="dialog" aria-label="授权">
      <button onClick={() =>{  complete(false) }}>取消授权</button><button onClick={() =>{  complete(true) }}>完成授权</button>
    </div>,
  }
  function Fixture() {
    const [draft, setDraft] = useState<AutomationTask>({ id: '', name: '推荐书籍', prompt: '推荐十本书', cwd: 'C:\\work', cadence: 'daily', time: '09:00', enabled: true, nextRunAt: 0 })
    return <TaskEditor draft={draft} change={setDraft} api={api} error="" titleId="editor" close={vi.fn()} save={() => { saved = draft }} />
  }
  render(<Fixture />)
  const feishu = await screen.findByRole('switch', { name: '消息推送到飞书' })
  expect(feishu.getAttribute('aria-checked')).toBe('false')
  expect(screen.queryByRole('button', { name: '选择连接器' })).toBeNull()
  fireEvent.change(screen.getByRole('textbox', { name: '任务说明' }), { target: { value: '保留修改后的任务说明' } })
  fireEvent.click(feishu)
  fireEvent.click(screen.getByText('取消授权'))
  expect(feishu.getAttribute('aria-checked')).toBe('false')
  fireEvent.click(feishu)
  fireEvent.click(screen.getByText('完成授权'))
  expect(screen.queryByRole('dialog', { name: '授权' })).toBeNull()
  expect(feishu.getAttribute('aria-checked')).toBe('true')
  fireEvent.click(screen.getByRole('switch', { name: '消息推送到钉钉' }))
  fireEvent.click(screen.getByRole('button', { name: '确定' }))
  expect(saved?.pushChannels).toEqual(['feishu', 'dingtalk'])
  expect(saved?.prompt).toBe('保留修改后的任务说明')
})
