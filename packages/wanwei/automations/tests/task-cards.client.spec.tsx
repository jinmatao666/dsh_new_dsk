// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AutomationCards, type AutomationApi } from '../src/client/task-cards.tsx'
import type { AutomationSnapshot } from '../src/contract.ts'
import { startAutomationConversation } from '../src/client/task-draft.ts'
import { RunHistory } from '../src/client/run-history.tsx'

afterEach(cleanup)
const empty: AutomationSnapshot = { tasks: [], runs: [] }
const directories = { listWorkspaces: async () => [], chooseDirectory: async () => null,
  listModels: async () => ({ default: { provider: 'mock', model: 'mock' }, routableProviders: ['mock'],
    groups: [{ id: 'mock', name: '测试模型', models: [{ id: 'mock', name: '模型 A' }, { id: 'other', name: '模型 B' }] }], failures: [] }) }

it('keeps popover search focused and searchable without an inner focus outline', async () => {
  const style = document.createElement('style')
  style.textContent = 'input:focus { outline: 2px solid blue; box-shadow: 0 0 0 2px blue; }\n'
    + readFileSync('packages/wanwei/automations/src/client/task-editor.css', 'utf8')
  document.head.append(style)
  try {
    render(<AutomationCards api={{ ...directories, call: vi.fn().mockResolvedValue(empty),
      openSession: vi.fn(), fromTask: vi.fn(),
      listWorkspaces: async () => [{ title: '资料目录', path: 'C:\\project' }] }} notify={vi.fn()} />)
    await screen.findByText('尚未配置自动化')
    fireEvent.click(screen.getByRole('button', { name: '新建' }))
    for (const [trigger, label] of [['选择工作空间', '搜索工作空间'], ['选择模型', '搜索模型']] as const) {
      fireEvent.click(screen.getByRole('button', { name: trigger }))
      const input = screen.getByRole('textbox', { name: label })
      expect(document.activeElement).toBe(input)
      expect(getComputedStyle(input).outline).toBe('none')
      expect(getComputedStyle(input).boxShadow).toBe('none')
      fireEvent.change(input, { target: { value: '不存在的项目' } })
      expect(screen.queryByRole('button', { name: trigger === '选择模型' ? '模型 A' : '资料目录' })).toBeNull()
      fireEvent.keyDown(input, { key: 'Escape' })
      expect(screen.queryByRole('textbox', { name: label })).toBeNull()
    }
  } finally { style.remove() }
})

it('keeps creation names readable while decorative SVG icons do not enter accessible labels', async () => {
  render(<AutomationCards api={{ ...directories, call: vi.fn().mockResolvedValue(empty),
    openSession: vi.fn(), fromTask: vi.fn() }} notify={vi.fn()} />)
  await screen.findByText('尚未配置自动化')
  const create = screen.getByRole('button', { name: '新建' })
  expect(create.textContent).toBe('新建')
  expect(create.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  const picker = screen.getByLabelText('新建方式')
  expect(picker.textContent).toBe('')
  expect(picker.querySelector('svg')?.getAttribute('focusable')).toBe('false')
  fireEvent.click(picker)
  const menu = picker.closest('details')
  if (menu === null) throw new Error('Creation picker requires its owning details menu')
  for (const name of ['手动新建', '从任务新建', '从模板新建']) {
    const action = within(menu).getByRole('button', { name })
    expect(action.textContent).toBe(name)
    expect(action.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  }
  fireEvent.keyDown(picker, { key: 'Escape' })
  expect(picker.closest('details')?.hasAttribute('open')).toBe(false)
})

it('selects an existing workspace or local folder without saving a task', async () => {
  const call = vi.fn().mockResolvedValue(empty)
  const chooseDirectory = vi.fn().mockResolvedValue('C:\\local-output')
  render(<AutomationCards api={{ ...directories, call, openSession: vi.fn(), fromTask: vi.fn(),
    listWorkspaces: async () => [{ title: '项目资料', path: 'C:\\project' }], chooseDirectory }} notify={vi.fn()} />)
  await screen.findByText('尚未配置自动化')
  fireEvent.click(screen.getByRole('button', { name: '新建' }))
  expect(screen.getByText('允许完全访问')).toBeTruthy()
  expect(screen.queryByText('保存后启用')).toBeNull()
  expect(screen.queryByText('工作区写入')).toBeNull()
  expect(screen.queryByLabelText('工作目录')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '选择工作空间' }))
  const workspaceButton = await screen.findByRole('button', { name: '项目资料' })
  expect(workspaceButton.querySelector('svg')).not.toBeNull()
  fireEvent.click(workspaceButton)
  expect(screen.getByRole('button', { name: '选择工作空间' }).title).toBe('C:\\project')
  fireEvent.click(screen.getByRole('button', { name: '选择工作空间' }))
  fireEvent.click(screen.getByText('打开本地文件夹'))
  await waitFor(() => { expect(screen.getByRole('button', { name: '选择工作空间' }).title).toBe('C:\\local-output') })
  expect(call.mock.calls.every(args => args[0] === 'list')).toBe(true)
  expect(screen.queryByText(/消息推送/)).toBeNull()
})

it('preserves the draft after directory cancellation or failure', async () => {
  const chooseDirectory = vi.fn().mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('选择目录失败'))
  render(<AutomationCards api={{ ...directories, call: vi.fn().mockResolvedValue(empty),
    openSession: vi.fn(), fromTask: vi.fn(), chooseDirectory,
    listWorkspaces: async () => [{ title: '原目录', path: 'C:\\original' }] }} notify={vi.fn()} />)
  await screen.findByText('尚未配置自动化')
  fireEvent.click(screen.getByRole('button', { name: '新建' }))
  fireEvent.click(screen.getByRole('button', { name: '选择工作空间' }))
  fireEvent.click(await screen.findByRole('button', { name: '原目录' }))
  fireEvent.click(screen.getByRole('button', { name: '选择工作空间' }))
  fireEvent.click(screen.getByText('打开本地文件夹'))
  await waitFor(() => { expect(screen.getByText('打开本地文件夹').hasAttribute('disabled')).toBe(false) })
  expect(screen.getByRole('button', { name: '选择工作空间' }).title).toBe('C:\\original')
  fireEvent.click(screen.getByText('打开本地文件夹'))
  await screen.findByText('Error: 选择目录失败')
  expect(screen.getByRole('button', { name: '选择工作空间' }).title).toBe('C:\\original')
})

it('shows real elapsed time and filters ledger rows by task name', () => {
  render(<RunHistory openSession={vi.fn()} remove={vi.fn()} runs={[
    { id: 'one', taskId: 'a', taskName: '周报', startedAt: 1000, endedAt: 54000, status: 'success', trigger: 'scheduled' },
    { id: 'two', taskId: 'b', taskName: '检查', startedAt: 1000, endedAt: 2000, status: 'failed', trigger: 'manual', error: '模型不可用' },
  ]} />)
  expect(screen.getByRole('columnheader', { name: '耗时' })).toBeTruthy()
  expect(screen.getByText('53 秒')).toBeTruthy()
  fireEvent.click(screen.getByText('查看失败原因'))
  expect(screen.getByText('模型不可用')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '搜索运行记录' }))
  fireEvent.change(screen.getByRole('textbox', { name: '搜索运行记录' }), { target: { value: '周报' } })
  expect(screen.queryByText('检查')).toBeNull()
  expect(screen.getByText('周报')).toBeTruthy()
})

it('opens office templates and selects a draft without saving or running it', async () => {
  const call = vi.fn().mockResolvedValue(empty)
  render(<AutomationCards api={{ ...directories, call, openSession: vi.fn(), fromTask: vi.fn() }} notify={vi.fn()} />)
  await screen.findByText('尚未配置自动化')
  fireEvent.click(screen.getByLabelText('新建方式'))
  fireEvent.click(screen.getByText(/从模板新建/))
  expect(screen.getByRole('heading', { name: '从模板添加' })).toBeTruthy()
  expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(6)
  fireEvent.click(screen.getByRole('button', { name: /项目周报汇总/ }))
  expect(screen.getByLabelText<HTMLInputElement>('任务名称').value).toBe('项目周报汇总')
  expect(screen.getByRole('button', { name: '选择工作空间' }).title).toBe('')
  expect(screen.queryByLabelText('保存后启用')).toBeNull()
  expect(call.mock.calls.every(args => args[0] === 'list')).toBe(true)
})

it('routes from-task creation to a staged conversation without sending', async () => {
  const fromTask = vi.fn()
  render(<AutomationCards api={{ ...directories, call: vi.fn().mockResolvedValue(empty),
    openSession: vi.fn(), fromTask }} notify={vi.fn()} />)
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
  const api: AutomationApi = { ...directories, call: vi.fn().mockResolvedValue(empty), openSession: vi.fn(), fromTask: vi.fn() }
  render(<AutomationCards api={api} notify={vi.fn()} />)
  expect(await screen.findByText('尚未配置自动化')).toBeTruthy()
  expect(screen.queryByRole('switch')).toBeNull()
  expect(screen.queryByRole('button', { name: '筛选任务' })).toBeNull()
  expect(screen.queryByText('正式任务需要电脑和 DSH 保持运行；错过的任务不会自动补执行。')).toBeNull()
  expect(screen.getByRole('button', { name: '搜索任务' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '已启用 (0)' })).toBeTruthy()
})

it('places batch actions after the task area and hides them on execution history', async () => {
  const api: AutomationApi = { ...directories, call: vi.fn().mockResolvedValue(empty), openSession: vi.fn(), fromTask: vi.fn() }
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
  render(<AutomationCards api={{ ...directories, call, openSession: vi.fn(), fromTask: vi.fn(), chooseDirectory: async () => 'C:\\work' }} notify={vi.fn()} />)
  await screen.findByText('尚未配置自动化')
  fireEvent.click(screen.getByRole('button', { name: '新建' }))
  fireEvent.change(screen.getByLabelText('任务名称'), { target: { value: '真实任务' } })
  fireEvent.change(screen.getByLabelText('任务说明'), { target: { value: '汇总文件' } })
  fireEvent.click(screen.getByRole('button', { name: '选择工作空间' }))
  // The native chooser is used instead of exposing an absolute-path textbox.
  fireEvent.click(screen.getByText('打开本地文件夹'))
  await waitFor(() => { expect(screen.getByRole('button', { name: '选择工作空间' }).title).toBe('C:\\work') })
  fireEvent.click(screen.getByRole('button', { name: '确定' }))
  await waitFor(() => { expect(screen.getAllByText('磁盘写入失败')).toHaveLength(2) })
  expect(call.mock.calls[1]?.[0]).toBe('save')
  expect(call.mock.calls[1]?.[1]).toMatchObject({ task: { name: '真实任务', cwd: 'C:\\work', prompt: '汇总文件' } })
  expect(screen.getByRole('dialog')).toBeTruthy()
})

it('selects and saves a concrete initial model instead of a default-model placeholder', async () => {
  const call = vi.fn().mockResolvedValue(empty)
  render(<AutomationCards api={{ ...directories, call, openSession: vi.fn(), fromTask: vi.fn(),
    listWorkspaces: async () => [{ title: '资料', path: 'C:\\work' }] }} notify={vi.fn()} />)
  await screen.findByText('尚未配置自动化')
  fireEvent.click(screen.getByRole('button', { name: '新建' }))
  await waitFor(() => { expect(screen.getByRole('button', { name: '选择模型' }).textContent).toBe('模型 A') })
  fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
  expect(screen.queryByRole('button', { name: '默认模型' })).toBeNull()
  expect(screen.getByRole('button', { name: '模型 A', pressed: true }).querySelector('svg')).not.toBeNull()
  expect(screen.getByRole('button', { name: '模型 B', pressed: false })).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('textbox', { name: '搜索模型' }), { key: 'Escape' })
  fireEvent.change(screen.getByLabelText('任务名称'), { target: { value: '检查' } })
  fireEvent.change(screen.getByLabelText('任务说明'), { target: { value: '检查资料' } })
  expect(screen.getByRole('button', { name: '确定' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '选择工作空间' }))
  fireEvent.click(await screen.findByRole('button', { name: '资料' }))
  expect(screen.getByRole('button', { name: '确定' }).hasAttribute('disabled')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '确定' }))
  await waitFor(() => { expect(call.mock.calls[1]?.[0]).toBe('save') })
  expect(call.mock.calls[1]?.[1]).toMatchObject({ task: { model: { provider: 'mock', model: 'mock' } } })
})

it('retains an existing task model when the current default differs', async () => {
  const snapshot: AutomationSnapshot = { tasks: [{ id: 'saved', name: '已配置任务', prompt: '检查',
    cwd: 'C:\\work', cadence: 'daily', time: '09:00', enabled: true, nextRunAt: 0,
    model: { provider: 'mock', model: 'other' } }], runs: [] }
  render(<AutomationCards api={{ ...directories, call: vi.fn().mockResolvedValue(snapshot),
    openSession: vi.fn(), fromTask: vi.fn() }} notify={vi.fn()} />)
  fireEvent.click(await screen.findByRole('button', { name: '已配置任务' }))
  fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
  expect(await screen.findByRole('button', { name: '模型 B', pressed: true })).toBeTruthy()
  expect(screen.getByRole('button', { name: '模型 A', pressed: false })).toBeTruthy()
})

it('saves model, permission and recurrence choices without changing the active conversation', async () => {
  const call = vi.fn().mockResolvedValue(empty)
  const openSession = vi.fn()
  render(<AutomationCards api={{ ...directories, call, openSession, fromTask: vi.fn(), chooseDirectory: async () => 'C:\\work' }} notify={vi.fn()} />)
  await screen.findByText('尚未配置自动化')
  fireEvent.click(screen.getByRole('button', { name: '新建' }))
  fireEvent.change(screen.getByLabelText('任务名称'), { target: { value: '完整配置' } })
  fireEvent.change(screen.getByLabelText('任务说明'), { target: { value: '检查资料' } })
  fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
  fireEvent.click(await screen.findByRole('button', { name: '模型 B' }))
  expect(screen.getByRole('button', { name: '选择模型' }).textContent).toBe('模型 B')
  fireEvent.click(screen.getByRole('button', { name: '选择模型' }))
  expect(screen.getByRole('button', { name: '模型 B', pressed: true })).toBeTruthy()
  expect(screen.getByRole('button', { name: '模型 A', pressed: false })).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('textbox', { name: '搜索模型' }), { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: '允许完全访问' }))
  const permission = screen.getByRole('switch', { name: '允许完全访问' })
  expect(permission.getAttribute('aria-checked')).toBe('true')
  fireEvent.click(permission)
  expect(permission.getAttribute('aria-checked')).toBe('false')
  fireEvent.keyDown(permission, { key: 'Escape' })
  expect(screen.getByRole('dialog', { name: '新建定时任务' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '触发频率' }))
  fireEvent.click(screen.getByRole('button', { name: '每月' }))
  fireEvent.click(screen.getByRole('button', { name: '执行时间' }))
  const timePanel = screen.getByRole('dialog', { name: '执行时间' })
  fireEvent.click(within(timePanel).getByRole('group', { name: '小时' }).querySelectorAll('button')[17]!)
  fireEvent.click(within(timePanel).getByRole('group', { name: '分钟' }).querySelectorAll('button')[13]!)
  fireEvent.keyDown(timePanel, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: '有效期' }))
  const calendar = screen.getByRole('dialog', { name: '有效期' })
  expect(calendar.parentElement).toBe(document.body)
  expect(calendar.closest('form')).toBeNull()
  fireEvent.click(within(calendar).getAllByRole('button', { name: '下个月' })[0]!)
  const date = new Date()
  const key = `${date.getFullYear() + Math.floor((date.getMonth() + 1) / 12)}-${String((date.getMonth() + 1) % 12 + 1).padStart(2, '0')}-20`
  fireEvent.click(within(calendar).getByRole('button', { name: key }))
  fireEvent.click(within(calendar).getByRole('button', { name: /结束日期/ }))
  fireEvent.click(within(calendar).getByRole('button', { name: key.replace(/20$/, '25') }))
  fireEvent.click(within(calendar).getByRole('button', { name: '确定' }))
  fireEvent.click(screen.getByRole('button', { name: '选择工作空间' }))
  fireEvent.click(screen.getByRole('button', { name: '打开本地文件夹' }))
  await waitFor(() => { expect(screen.getByRole('button', { name: '选择工作空间' }).title).toBe('C:\\work') })
  fireEvent.click(screen.getByRole('button', { name: '确定' }))
  await waitFor(() => { expect(call.mock.calls.some(args => args[0] === 'save')).toBe(true) })
  const payload: unknown = call.mock.calls.find(args => args[0] === 'save')?.[1]
  expect(payload).toMatchObject({ task: {
    cadence: 'monthly', startDate: key, endDate: key.replace(/20$/, '25'), time: '17:13', fullAccess: false,
    model: { provider: 'mock', model: 'other' }, enabled: true,
  } })
  expect(openSession).not.toHaveBeenCalled()
})

it('opens the Session associated with an actual Host run record', async () => {
  const openSession = vi.fn()
  const api: AutomationApi = { ...directories, openSession, fromTask: vi.fn(), call: vi.fn().mockResolvedValue({
    tasks: [], runs: [{ id: 'run', taskId: 'task', taskName: '真实任务', status: 'success',
      trigger: 'manual', startedAt: 1, sessionId: 'session' }],
  }) }
  render(<AutomationCards api={api} notify={vi.fn()} />)
  await screen.findByText('尚未配置自动化')
  fireEvent.click(screen.getByText('运行记录'))
  fireEvent.click(screen.getByText('真实任务'))
  expect(openSession).toHaveBeenCalledWith('session')
})

it('expands task search inside the toolbar without rendering explanatory copy', async () => {
  render(<AutomationCards api={{ ...directories, call: vi.fn().mockResolvedValue(empty),
    openSession: vi.fn(), fromTask: vi.fn() }} notify={vi.fn()} />)
  await screen.findByText('尚未配置自动化')
  expect(screen.queryByText(/任务保存在本机/)).toBeNull()
  expect(screen.queryByRole('textbox', { name: '搜索任务' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '搜索任务' }))
  const search = screen.getByRole('textbox', { name: '搜索任务' })
  expect(search.closest('.automation-card-toolbar')).toBeTruthy()
  expect(document.activeElement).toBe(search)
  fireEvent.change(search, { target: { value: '周报' } })
  fireEvent.keyDown(search, { key: 'Escape' })
  expect(screen.queryByRole('textbox', { name: '搜索任务' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '搜索任务' }))
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: '搜索任务' }).value).toBe('')
  fireEvent.blur(screen.getByRole('textbox', { name: '搜索任务' }))
  expect(screen.queryByRole('textbox', { name: '搜索任务' })).toBeNull()
  fireEvent.click(screen.getByText('运行记录'))
  expect(screen.queryByText(/任务保存在本机/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '搜索运行记录' }))
  expect(screen.getByRole('textbox', { name: '搜索运行记录' }).closest('.automation-card-toolbar')).toBeTruthy()
})

it('opens ledger rows by click or keyboard while deletion and failure details do not navigate', () => {
  const openSession = vi.fn()
  const remove = vi.fn()
  render(<RunHistory openSession={openSession} remove={remove} runs={[
    { id: 'one', taskId: 'a', taskName: '周报', startedAt: 1000, endedAt: 54000,
      status: 'success', trigger: 'scheduled', sessionId: 'session-one' },
    { id: 'two', taskId: 'b', taskName: '检查', startedAt: 1000,
      status: 'running', trigger: 'manual', sessionId: 'session-two' },
    { id: 'three', taskId: 'c', taskName: '失败', startedAt: 1000, endedAt: 2000,
      status: 'failed', trigger: 'manual', error: '失败原因', sessionId: 'session-three' },
  ]} />)
  const row = screen.getByText('周报').closest('tr')!
  fireEvent.click(row)
  fireEvent.keyDown(row, { key: 'Enter' })
  expect(openSession.mock.calls).toEqual([['session-one'], ['session-one']])
  fireEvent.click(screen.getByRole('button', { name: '删除运行记录 周报' }))
  expect(remove).toHaveBeenCalledWith('one')
  expect(openSession).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('button', { name: '删除运行记录 检查' }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByText('查看失败原因'))
  expect(openSession).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('定时执行')).toBeNull()
  expect(screen.queryByRole('button', { name: '停止执行' })).toBeNull()
  expect(screen.getAllByText('本地')).toHaveLength(3)
})

it('confirms record-only deletion through RPC without opening or deleting its Session', async () => {
  const snapshot: AutomationSnapshot = { tasks: [], runs: [{ id: 'run', taskId: 'task', taskName: '周报',
    status: 'success', trigger: 'scheduled', startedAt: 1, endedAt: 2, sessionId: 'session' }] }
  const call = vi.fn().mockImplementation(async (operation: string) => operation === 'delete-run' ? empty : snapshot)
  const openSession = vi.fn()
  render(<AutomationCards api={{ ...directories, call, openSession, fromTask: vi.fn() }} notify={vi.fn()} />)
  await screen.findByText('尚未配置自动化')
  fireEvent.click(screen.getByText('运行记录'))
  fireEvent.click(screen.getByRole('button', { name: '删除运行记录 周报' }))
  expect(call.mock.calls.every(args => args[0] === 'list')).toBe(true)
  fireEvent.click(within(screen.getByRole('dialog', { name: '删除运行记录' })).getByText('确认删除'))
  await screen.findByText('暂无真实运行记录')
  expect(call).toHaveBeenCalledWith('delete-run', { id: 'run' }, expect.any(AbortSignal))
  expect(openSession).not.toHaveBeenCalled()
})
