// @vitest-environment jsdom
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createPanelController, FeaturePanel, type PanelController, type PanelProps } from '@deepseek-ai/dsh-wanwei-feature-panels/client'
import { AutomationCards, type AutomationApi } from '../src/client/task-cards.tsx'
import { localDateKey } from '../src/client/task-labels.ts'

it('keeps the real feature panel and draft open across body-portal selections, but still permits navigation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'automation-editor-navigation-'))
  const ctx = new Context()
  let controller: PanelController | undefined
  try {
    const config = join(directory, 'cordis.yml')
    await writeFile(config, '- name: navigation-fixture\n')
    ctx.baseUrl = pathToFileURL(directory).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.internal = { version: 'v2', async import(name: string) {
      if (name !== 'navigation-fixture') throw new Error(`Unexpected fixture plugin: ${name}`)
      return { apply(scope: Context) { controller = createPanelController(scope, 'automation-navigation-test') } }
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(config).href } })
    await ctx.loader.await()
    if (controller === undefined) throw new Error('Loader did not create the feature controller')
    const owned = controller
    const call = vi.fn().mockResolvedValue({ tasks: [], runs: [] })
    const api: AutomationApi = {
      call, openSession: vi.fn(), fromTask: vi.fn(), chooseDirectory: async () => null,
      listWorkspaces: async () => [{ title: '资料目录', path: 'C:\\project' }],
      listModels: async () => ({ default: { provider: 'mock', model: 'a' }, routableProviders: ['mock'], failures: [],
        groups: [{ id: 'mock', name: '测试', models: [{ id: 'a', name: '模型 A' }] }] }),
    }
    const props = { controller: owned, title: '自动化', subtitle: '', blockedIntranet: false,
      useNetwork: () => false, renderContent: () => <AutomationCards api={api} notify={vi.fn()} />,
    } as unknown as PanelProps
    render(<><FeaturePanel {...props} /><button type="button">对话导航</button></>)
    act(() => { owned.open() })
    await screen.findByText('尚未配置自动化')
    const click = (element: Element) => { fireEvent.pointerDown(element); fireEvent.click(element) }
    click(screen.getByRole('button', { name: '新建' }))
    const name = screen.getByPlaceholderText('输入任务名称')
    fireEvent.pointerDown(name)
    fireEvent.change(name, { target: { value: '保留草稿' } })
    fireEvent.change(screen.getByPlaceholderText('添加提示词'), { target: { value: '汇总资料' } })
    click(screen.getByRole('button', { name: '选择模型' }))
    click(await screen.findByRole('button', { name: '模型 A' }))
    expect(owned.isOpen()).toBe(true)
    expect(screen.getByRole('button', { name: '选择模型' }).textContent).toBe('模型 A')
    click(screen.getByRole('button', { name: '选择工作空间' }))
    click(await screen.findByRole('button', { name: '资料目录' }))
    expect(owned.isOpen()).toBe(true)
    expect(screen.getByRole('button', { name: '选择工作空间' }).title).toBe('C:\\project')
    click(screen.getByRole('button', { name: '允许完全访问' }))
    click(within(screen.getByRole('dialog', { name: '执行权限' })).getByRole('switch'))
    expect(owned.isOpen()).toBe(true)
    fireEvent.keyDown(screen.getByRole('dialog', { name: '执行权限' }), { key: 'Escape' })
    expect(screen.getByRole('button', { name: '工作区写入' })).toBeTruthy()
    click(screen.getByRole('button', { name: '触发频率' }))
    click(within(screen.getByRole('dialog', { name: '重复' })).getByRole('button', { name: '每天' }))
    expect(owned.isOpen()).toBe(true)
    expect(screen.getByRole('button', { name: '触发频率' }).textContent).toContain('每天')
    click(screen.getByRole('button', { name: '执行时间' }))
    click(within(screen.getByRole('group', { name: '小时' })).getByRole('button', { name: '12' }))
    expect(owned.isOpen()).toBe(true)
    expect(screen.getByRole('button', { name: '执行时间' }).textContent).toContain('12:00')
    fireEvent.keyDown(screen.getByRole('dialog', { name: '执行时间' }), { key: 'Escape' })
    click(screen.getByRole('button', { name: '有效期' }))
    const date = within(screen.getByRole('dialog', { name: '有效期' }))
      .getAllByRole('button', { name: localDateKey(new Date()) })[0]
    if (date === undefined) throw new Error('Calendar must offer today')
    click(date)
    expect(owned.isOpen()).toBe(true)
    expect(screen.getByDisplayValue('保留草稿')).toBeTruthy()
    expect(call.mock.calls.every(args => args[0] === 'list')).toBe(true)
    click(screen.getByRole('button', { name: '对话导航' }))
    expect(owned.isOpen()).toBe(false)
    expect(screen.queryByDisplayValue('保留草稿')).toBeNull()
    act(() => { owned.open() })
    click(screen.getByRole('button', { name: '返回' }))
    expect(owned.isOpen()).toBe(false)
  } finally {
    cleanup()
    await ctx.fiber.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
