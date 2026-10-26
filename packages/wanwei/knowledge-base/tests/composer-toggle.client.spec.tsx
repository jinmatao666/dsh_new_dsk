// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { KnowledgeComposerToggle, type KnowledgeToggleProps } from '../src/client/KnowledgeComposerToggle.tsx'
import { createRetrievalSelection } from '../src/client/retrieval-selection.ts'

afterEach(cleanup)

const catalog = {
  items: [
    { id: 1, name: '我的笔记', description: '', kind: 'personal' as const, owner_user_id: 9 },
    { id: 2, name: '制度库', description: '公司制度', kind: 'common' as const, owner_user_id: 1, category_id: 5 },
    { id: 3, name: '课程库', description: '订阅课程', kind: 'shared' as const, owner_user_id: 1, category_id: 6 },
  ],
  categories: [
    { id: 5, name: '公共资料', type: 'common' as const, require_auth: false },
    { id: 6, name: '授权资料', type: 'shared' as const, require_auth: true },
  ],
}

function mount(sessionId: string | undefined, visible = true) {
  const selection = createRetrievalSelection()
  const syncScope = vi.fn(async (_sessionId: string, _ids: readonly number[]) => {})
  const openLibrary = vi.fn()
  function Harness() {
    const value = useSyncExternalStore(fn => selection.subscribe(fn), () => selection.getSnapshot())
    const props = {
      sessionId,
      useSelection: (pick: (input: typeof value) => typeof value) => pick(value),
      useVisible: (pick: (input: boolean) => boolean) => pick(visible),
      setSelection: (next: typeof value) => { selection.set(next) },
      loadCatalog: async () => catalog,
      syncScope,
      openLibrary,
    } as unknown as KnowledgeToggleProps
    return <KnowledgeComposerToggle {...props} />
  }
  render(<Harness />)
  return { selection, syncScope, openLibrary }
}

it('groups libraries by desktop type and scopes the Session to the checked ones', async () => {
  const { selection, syncScope } = mount('s1')
  await waitFor(() => { expect(syncScope).toHaveBeenLastCalledWith('s1', []) })
  expect(screen.queryByRole('button', { name: /选择知识库/ })).toBeNull()

  fireEvent.click(screen.getByRole('switch', { name: /知识库/ }))
  const picker = await screen.findByRole('dialog', { name: '选择知识库' })
  const tabs = within(picker).getByRole('navigation', { name: '知识库类型' })
  expect(within(tabs).getAllByRole('button').map(button => button.textContent)).toEqual(['个人知识库', '公共资料', '订阅知识库'])

  fireEvent.click(await within(picker).findByRole('option', { name: /我的笔记/ }))
  fireEvent.click(within(tabs).getByRole('button', { name: '订阅知识库' }))
  fireEvent.click(within(picker).getByRole('option', { name: /课程库/ }))
  expect(selection.getSnapshot()).toEqual({ enabled: true, ids: [1, 3] })
  await waitFor(() => { expect(syncScope).toHaveBeenLastCalledWith('s1', [1, 3]) })
  expect(within(picker).getByText('已选 2 个')).toBeTruthy()

  fireEvent.click(within(picker).getByRole('button', { name: '完成' }))
  expect(screen.getByRole('button', { name: /已选 2 个/ })).toBeTruthy()
})

it('turning the switch off hides the library controls and clears the Session scope', async () => {
  const { selection, syncScope } = mount('s1')
  selection.set({ enabled: true, ids: [2] })
  await waitFor(() => { expect(syncScope).toHaveBeenLastCalledWith('s1', [2]) })
  expect(await screen.findByRole('button', { name: '制度库' })).toBeTruthy()

  fireEvent.click(screen.getByRole('switch', { name: /知识库/ }))
  expect(screen.queryByRole('button', { name: '制度库' })).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
  await waitFor(() => { expect(syncScope).toHaveBeenLastCalledWith('s1', []) })
  expect(selection.getSnapshot()).toEqual({ enabled: false, ids: [2] })
})

it('renders nothing and syncs no scope when the deployment hides knowledge libraries', async () => {
  const { selection, syncScope } = mount('s1', false)
  selection.set({ enabled: true, ids: [2] })
  expect(screen.queryByRole('switch')).toBeNull()
  await waitFor(() => { expect(syncScope).toHaveBeenLastCalledWith('s1', []) })
})

it('skips Host sync without a Session', async () => {
  const { syncScope } = mount(undefined)
  fireEvent.click(screen.getByRole('switch', { name: /知识库/ }))
  await screen.findByRole('dialog', { name: '选择知识库' })
  expect(syncScope).not.toHaveBeenCalled()
})

it('loads the catalog asynchronously and reveals long lists in chunks', async () => {
  const observer = globalThis.IntersectionObserver
  // Keep chunking deterministic: auto-reveal via IntersectionObserver is covered in the browser.
  // @ts-expect-error test stub
  globalThis.IntersectionObserver = undefined
  const many = {
    items: Array.from({ length: 55 }, (_, index) => ({
      id: index + 1,
      name: `库${index + 1}`,
      description: '',
      kind: 'personal' as const,
      owner_user_id: 9,
    })),
    categories: [] as typeof catalog.categories,
  }
  const selection = createRetrievalSelection()
  const loadCatalog = vi.fn(async () => {
    await Promise.resolve()
    return many
  })
  function Harness() {
    const value = useSyncExternalStore(fn => selection.subscribe(fn), () => selection.getSnapshot())
    const props = {
      sessionId: 's1',
      useSelection: (pick: (input: typeof value) => typeof value) => pick(value),
      useVisible: (pick: (input: boolean) => boolean) => pick(true),
      setSelection: (next: typeof value) => { selection.set(next) },
      loadCatalog,
      syncScope: vi.fn(async () => {}),
      openLibrary: vi.fn(),
    } as unknown as KnowledgeToggleProps
    return <KnowledgeComposerToggle {...props} />
  }
  try {
    render(<Harness />)
    fireEvent.click(screen.getByRole('switch', { name: /知识库/ }))
    const picker = await screen.findByRole('dialog', { name: '选择知识库' })
    await waitFor(() => { expect(loadCatalog).toHaveBeenCalled() })
    await waitFor(() => { expect(within(picker).getByText('库1')).toBeTruthy() })
    expect(within(picker).queryByText('库55')).toBeNull()
    expect(within(picker).getByText('已显示 40 / 55')).toBeTruthy()
    fireEvent.click(within(picker).getByRole('button', { name: '加载更多' }))
    expect(within(picker).getByText('库55')).toBeTruthy()
  } finally {
    globalThis.IntersectionObserver = observer
  }
})
