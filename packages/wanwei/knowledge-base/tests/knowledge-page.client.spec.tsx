// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { clearKnowledgeDownloadCache, KnowledgePage, type KnowledgeApi } from '../src/client/KnowledgePage.tsx'

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  AnnotationMode: { DISABLE: 0, ENABLE: 1, ENABLE_FORMS: 2, ENABLE_STORAGE: 3 },
  Util: {
    transform: (_viewport: number[], item: number[]) => item,
  },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      async getPage() {
        return {
          getViewport: () => ({ width: 120, height: 160, transform: [1, 0, 0, 1, 0, 0] }),
          render: () => ({ promise: Promise.resolve() }),
          getTextContent: async () => ({ items: [] }),
        }
      },
      async destroy() {},
    }),
  }),
}))

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs', () => ({
  WorkerMessageHandler: { setup() {} },
}))

afterEach(() => {
  clearKnowledgeDownloadCache()
  cleanup()
})

function stubCanvas() {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    fillRect() {},
    clearRect() {},
    drawImage() {},
    save() {},
    restore() {},
    scale() {},
    translate() {},
    transform() {},
    setTransform() {},
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/png;base64,AA==')
  HTMLCanvasElement.prototype.toBlob = vi.fn(function toBlob(callback: BlobCallback) {
    callback(new Blob(['x'], { type: 'image/jpeg' }))
  }) as unknown as typeof HTMLCanvasElement.prototype.toBlob
}

function api(): KnowledgeApi {
  return {
    list: vi.fn(async () => [
      { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
      { id: 3, name: '团队共享', description: '共享', kind: 'shared' as const, owner_user_id: 7 },
    ]),
    categories: vi.fn(async () => []),
    plaza: vi.fn(async () => []),
    plazaItem: vi.fn(async () => {
      throw new Error('missing plaza item')
    }),
    plazaDocuments: vi.fn(async () => []),
    subscribe: vi.fn(async () => {}),
    unsubscribe: vi.fn(async () => {}),
    create: vi.fn(async input => ({ id: 2, owner_user_id: 7, ...input })),
    documents: vi.fn(async () => [{ id: 'doc-1', name: '说明.pdf', size: 2048, run: 'DONE', progress: 1 }]),
    chunks: vi.fn(async () => [{ id: 'chunk-1', content: '文档正文内容' }]),
    download: vi.fn(async () => ({ contentType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) })),
    upload: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    copy: vi.fn(async () => {}),
    move: vi.fn(async () => {}),
    messages: vi.fn(async () => []),
    clearMessages: vi.fn(async () => {}),
    complete: vi.fn(async () => ({ answer: '知识库回答', recommendations: ['继续提问'] })),
  }
}

it('loads authorized knowledge bases and creates a personal library', async () => {
  const service = api()
  render(<KnowledgePage api={service} />)
  expect(await screen.findByText('说明.pdf')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '新建订阅知识库' })).toBeNull()
  expect(screen.queryByRole('button', { name: '新建共享知识库' })).toBeNull()
  expect(screen.queryByText('共享知识库')).toBeNull()
  expect(screen.queryByText('订阅知识库')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '新建个人知识库' }))
  expect(screen.getByRole('dialog', { name: '新建个人知识库' })).toBeTruthy()
  fireEvent.change(screen.getByPlaceholderText('请输入知识库名称'), { target: { value: '协作资料' } })
  fireEvent.click(screen.getByText('确定'))
  await waitFor(() => expect(screen.getAllByText('协作资料')).toHaveLength(2))
  expect(service.create).toHaveBeenCalledWith({ name: '协作资料', description: '', kind: 'personal' })
  fireEvent.click(screen.getByRole('button', { name: '上传文档' }))
  expect(screen.getByRole('menuitem', { name: '本地文件' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '本地文件夹' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '新建文件夹' })).toBeTruthy()
  expect(screen.getByText('PDF')).toBeTruthy()
})

it('selects the first library of the first sidebar group on open', async () => {
  const service = api()
  service.categories = vi.fn(async () => [
    { id: 3, name: '公开规范', type: 'common' as const, require_auth: false },
  ])
  service.list = vi.fn(async () => [
    { id: 9, name: '公开库甲', description: '公开', kind: 'common' as const, owner_user_id: 2, category_id: 3 },
    { id: 1, name: '我的资料', description: '个人', kind: 'personal' as const, owner_user_id: 7 },
    { id: 2, name: '我的第二库', description: '个人', kind: 'personal' as const, owner_user_id: 7 },
  ])
  service.documents = vi.fn(async (id: number) => [{
    id: `doc-${id}`, name: `库${id}.pdf`, size: 1024, run: 'DONE' as const, progress: 1,
  }])
  render(<KnowledgePage api={service} />)
  expect(await screen.findByText('库1.pdf')).toBeTruthy()
  const personal = screen.getByText('个人知识库').closest('.dsh-knowledge-group') as HTMLElement
  expect(within(personal).getByText('我的资料').closest('button')?.className).toContain('active')
  expect(service.documents).toHaveBeenCalledWith(1)
})

it('hides auth category names from the sidebar and discovers them only in the plaza', async () => {
  const service = api()
  const plazaItem = {
    id: 9,
    name: '地方法规知识库',
    description: '地方法规合集',
    kind: 'common' as const,
    owner_user_id: 2,
    category_id: 4,
    category_name: '法律',
    owner_username: '法务平台',
    subscription_status: 'none' as const,
  }
  service.categories = vi.fn(async () => [
    { id: 3, name: '公开规范', type: 'common' as const, require_auth: false },
    { id: 4, name: '法律', type: 'shared' as const, require_auth: true },
  ])
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    { id: 5, name: '公开汇编', description: '开放', kind: 'common' as const, owner_user_id: 2, category_id: 3 },
  ])
  service.plaza = vi.fn(async () => [plazaItem])
  service.plazaItem = vi.fn(async () => plazaItem)
  service.plazaDocuments = vi.fn(async () => [
    { id: 'doc-zhejiang', name: '浙江省/条例.pdf', location: '浙江省/条例.pdf', size: 1024, run: 'DONE', progress: 1, update_time: 1_729_036_800 },
    { id: 'doc-anhui', name: '安徽省/办法.pdf', location: '安徽省/办法.pdf', size: 1024, run: 'DONE', progress: 1, update_time: 1_729_036_800 },
  ])
  service.subscribe = vi.fn(async () => {})
  render(<KnowledgePage api={service} />)
  expect(await screen.findByText('公共知识库')).toBeTruthy()
  expect(screen.queryByText('公开规范')).toBeNull()
  expect(screen.queryByText('法律')).toBeNull()
  expect(screen.queryByText('订阅知识库')).toBeNull()
  const open = screen.getByText('公共知识库').closest('.dsh-knowledge-group')
  expect(within(open as HTMLElement).getByText('公开汇编')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /知识库广场/ }))
  expect(await screen.findByText('地方法规知识库')).toBeTruthy()
  expect(screen.getByText('订阅后需管理员审核，通过后会出现在左侧订阅知识库；自建与已订阅的知识库不再出现在广场。')).toBeTruthy()
  expect(screen.queryByRole('tab')).toBeNull()
  expect(service.plaza).toHaveBeenCalledWith({})
  fireEvent.click(screen.getByRole('button', { name: /地方法规知识库/ }))
  expect(await screen.findByRole('button', { name: '订阅' })).toBeTruthy()
  expect(await screen.findByText('浙江省')).toBeTruthy()
  expect(screen.getByText('安徽省')).toBeTruthy()
  expect(service.plazaDocuments).toHaveBeenCalledWith(9)
  fireEvent.click(screen.getByRole('button', { name: '订阅' }))
  await waitFor(() => expect(service.subscribe).toHaveBeenCalledWith(9))
  expect(await screen.findByRole('button', { name: '审核中' })).toBeTruthy()
})

it('places approved auth-category libraries under 订阅知识库 instead of the category name', async () => {
  const service = api()
  service.categories = vi.fn(async () => [
    { id: 4, name: '法律', type: 'shared' as const, require_auth: true },
  ])
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    {
      id: 8, name: '已订法规', description: '已通过', kind: 'shared' as const,
      owner_user_id: 2, category_id: 4, owned_by_viewer: false, subscribed_by_viewer: true,
    },
  ])
  render(<KnowledgePage api={service} />)
  expect(await screen.findByText('订阅知识库')).toBeTruthy()
  expect(screen.queryByText('法律')).toBeNull()
  const subscription = screen.getByText('订阅知识库').closest('.dsh-knowledge-group')
  expect(within(subscription as HTMLElement).getByText('已订法规')).toBeTruthy()
})

it('keeps admin-created auth libraries out of 订阅知识库 until a grant exists', async () => {
  const service = api()
  service.categories = vi.fn(async () => [
    { id: 4, name: '法律', type: 'shared' as const, require_auth: true },
  ])
  // Accessible only as owner (or mistakenly listed): no grant → not under 订阅知识库.
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    {
      id: 9, name: '平台法规', description: '管理员创建', kind: 'shared' as const,
      owner_user_id: 2, category_id: 4, owned_by_viewer: false, subscribed_by_viewer: false,
    },
  ])
  service.plaza = vi.fn(async () => [{
    id: 9, name: '平台法规', description: '管理员创建', kind: 'shared' as const,
    owner_user_id: 2, category_id: 4, category_name: '法律',
    owner_username: 'admin', subscription_status: 'none' as const,
  }])
  render(<KnowledgePage api={service} />)
  expect(await screen.findByRole('button', { name: '我的资料' })).toBeTruthy()
  expect(screen.queryByText('订阅知识库')).toBeNull()
  expect(screen.queryByText('平台法规')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /知识库广场/ }))
  const plaza = await screen.findByRole('region', { name: '知识库广场' })
  expect(within(plaza).getByRole('button', { name: /平台法规/ })).toBeTruthy()
})

it('places owned auth-category libraries under 订阅知识库 above grants without 取消订阅', async () => {
  const service = api()
  service.categories = vi.fn(async () => [
    { id: 4, name: '法律', type: 'shared' as const, require_auth: true },
  ])
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    {
      id: 9, name: '已订法规', description: '已通过', kind: 'shared' as const,
      owner_user_id: 2, category_id: 4, owned_by_viewer: false, subscribed_by_viewer: true,
    },
    {
      id: 8, name: '我建的法规', description: '自建', kind: 'shared' as const,
      owner_user_id: 7, category_id: 4, owned_by_viewer: true, subscribed_by_viewer: false,
    },
  ])
  service.plaza = vi.fn(async () => [])
  render(<KnowledgePage api={service} />)
  expect(await screen.findByText('订阅知识库')).toBeTruthy()
  const subscription = screen.getByText('订阅知识库').closest('.dsh-knowledge-group') as HTMLElement
  const labels = within(subscription).getAllByRole('button')
    .map(button => button.textContent || '')
    .filter(text => text.includes('法规'))
  expect(labels[0]).toContain('我建的法规')
  expect(labels[1]).toContain('已订法规')
  fireEvent.click(within(subscription).getByText('我建的法规'))
  expect(screen.queryByRole('button', { name: '取消订阅' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /知识库广场/ }))
  const plaza = await screen.findByRole('region', { name: '知识库广场' })
  expect(within(plaza).queryByRole('button', { name: /我建的法规/ })).toBeNull()
})

it('collapses and expands each sidebar knowledge group', async () => {
  const service = api()
  service.categories = vi.fn(async () => [
    { id: 4, name: '法律', type: 'shared' as const, require_auth: true },
  ])
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    {
      id: 8, name: '已订法规', description: '已通过', kind: 'shared' as const,
      owner_user_id: 2, category_id: 4, owned_by_viewer: false, subscribed_by_viewer: true,
    },
  ])
  render(<KnowledgePage api={service} />)
  expect(await screen.findByText('已订法规')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '收起订阅知识库' }))
  expect(screen.queryByText('已订法规')).toBeNull()
  expect(screen.getByRole('button', { name: '展开订阅知识库' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '展开订阅知识库' }))
  expect(screen.getByText('已订法规')).toBeTruthy()
  const personal = screen.getByText('个人知识库').closest('.dsh-knowledge-group') as HTMLElement
  expect(within(personal).getByText('我的资料')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '收起个人知识库' }))
  expect(within(personal).queryByText('我的资料')).toBeNull()
})

it('unsubscribes a subscribed library so it leaves 订阅知识库', async () => {
  const service = api()
  service.categories = vi.fn(async () => [
    { id: 4, name: '法律', type: 'shared' as const, require_auth: true },
  ])
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    {
      id: 8, name: '已订法规', description: '已通过', kind: 'shared' as const,
      owner_user_id: 2, category_id: 4, owned_by_viewer: false, subscribed_by_viewer: true,
    },
  ])
  service.unsubscribe = vi.fn(async () => {
    service.list = vi.fn(async () => [
      { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
    ])
  })
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByText('已订法规'))
  expect(await screen.findByRole('button', { name: '取消订阅' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '取消订阅' }))
  await waitFor(() => expect(service.unsubscribe).toHaveBeenCalledWith(8))
  await waitFor(() => expect(screen.queryByText('订阅知识库')).toBeNull())
})

it('hides 公共知识库 and 订阅知识库 when those groups are empty', async () => {
  const service = api()
  service.categories = vi.fn(async () => [
    { id: 3, name: '公开规范', type: 'common' as const, require_auth: false },
    { id: 4, name: '法律', type: 'shared' as const, require_auth: true },
  ])
  service.list = vi.fn(async () => [
    { id: 1, name: '我的资料', description: '测试资料', kind: 'personal' as const, owner_user_id: 7 },
  ])
  render(<KnowledgePage api={service} />)
  expect(await screen.findAllByText('我的资料')).not.toHaveLength(0)
  expect(screen.queryByText('公共知识库')).toBeNull()
  expect(screen.queryByText('订阅知识库')).toBeNull()
  expect(screen.queryByText('公开规范')).toBeNull()
})

it('uploads every file from a local folder into the selected knowledge base', async () => {
  const service = api()
  const { container } = render(<KnowledgePage api={service} />)
  await screen.findByText('说明.pdf')
  const folderInput = container.querySelector('input[webkitdirectory]') as HTMLInputElement
  expect(folderInput).toBeTruthy()
  expect(folderInput.getAttribute('webkitdirectory')).toBe('')
  const nested = new File(['body'], 'nested.md', { type: 'text/markdown' })
  Object.defineProperty(nested, 'webkitRelativePath', { value: '资料/nested.md' })
  const junk = new File([''], '.DS_Store', { type: 'text/plain' })
  Object.defineProperty(junk, 'webkitRelativePath', { value: '资料/.DS_Store' })
  const top = new File(['guide'], '指南.txt', { type: 'text/plain' })
  Object.defineProperty(top, 'webkitRelativePath', { value: '资料/指南.txt' })
  fireEvent.change(folderInput, { target: { files: [nested, junk, top] } })
  await waitFor(() => expect(service.upload).toHaveBeenCalledTimes(2))
  const uploaded = vi.mocked(service.upload).mock.calls.map((call: [number, File]) => ({
    id: call[0],
    name: call[1].name,
  }))
  expect(uploaded).toEqual([{ id: 1, name: 'nested.md' }, { id: 1, name: '指南.txt' }])
  expect(service.documents).toHaveBeenCalled()
})

it('shows uploaded folder paths as expandable folders with nested files', async () => {
  const service = api()
  service.documents = vi.fn(async () => [
    { id: 'doc-1', name: '资料/说明.pdf', location: '资料/说明.pdf', size: 2048, run: 'DONE', progress: 1 },
    { id: 'doc-2', name: '资料/子目录/笔记.md', location: '资料/子目录/笔记.md', size: 128, run: 'DONE', progress: 1 },
    { id: 'doc-3', name: '根目录.txt', size: 32, run: 'DONE', progress: 1 },
  ])
  render(<KnowledgePage api={service} />)
  expect(await screen.findByRole('button', { name: /资料/ })).toBeTruthy()
  expect(screen.getByText('说明.pdf')).toBeTruthy()
  expect(screen.getByText('根目录.txt')).toBeTruthy()
  expect(screen.queryByText('笔记.md')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /子目录/ }))
  expect(await screen.findByText('笔记.md')).toBeTruthy()
  expect(screen.getAllByText('文件夹').length).toBeGreaterThan(0)
})

it('drags the divider to change the content width', async () => {
  const { container } = render(<KnowledgePage api={api()} />)
  const section = container.querySelector('.dsh-knowledge') as HTMLElement
  section.getBoundingClientRect = () => ({
    x: 0, y: 0, left: 0, top: 0, right: 1200, bottom: 700, width: 1200, height: 700, toJSON() { return {} },
  })
  const split = await screen.findByRole('separator', { name: '调整内容宽度' })
  fireEvent.pointerDown(split, { button: 0, clientX: 490 })
  fireEvent.pointerMove(window, { clientX: 640 })
  expect(split.getAttribute('aria-valuenow')).toBe('430')
  fireEvent.pointerUp(window)
  fireEvent.keyDown(split, { key: 'ArrowLeft' })
  expect(split.getAttribute('aria-valuenow')).toBe('414')
})

it('restores saved Q&A turns when opening a knowledge base', async () => {
  const service = api()
  service.messages = vi.fn(async () => [
    { role: 'user' as const, content: '上次的问题' },
    { role: 'assistant' as const, content: '上次的回答' },
  ])
  const { container } = render(<KnowledgePage api={service} />)
  const pane = container.querySelector('.dsh-knowledge-messages') as HTMLDivElement
  Object.defineProperty(pane, 'scrollHeight', { configurable: true, get: () => 960 })
  await waitFor(() => expect(service.messages).toHaveBeenCalledWith(1))
  expect(await screen.findByText('上次的问题')).toBeTruthy()
  expect(screen.getByText('上次的回答')).toBeTruthy()
  expect(screen.getByText('万维')).toBeTruthy()
  expect(pane.scrollTop).toBe(0)
})

it('clears saved Q&A turns and leaves the empty knowledge chat', async () => {
  const service = api()
  service.messages = vi.fn(async () => [
    { role: 'user' as const, content: '上次的问题' },
    { role: 'assistant' as const, content: '上次的回答' },
  ])
  render(<KnowledgePage api={service} />)
  expect(await screen.findByText('上次的问题')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '清空会话' }))
  await waitFor(() => expect(service.clearMessages).toHaveBeenCalledWith(1))
  await waitFor(() => expect(screen.queryByText('上次的问题')).toBeNull())
  expect(screen.queryByText('上次的回答')).toBeNull()
  expect(screen.getByText('基于知识库问答')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '清空会话' })).toBeNull()
})

it('restores Q&A turns when clearing the session fails', async () => {
  const service = api()
  service.messages = vi.fn(async () => [
    { role: 'user' as const, content: '上次的问题' },
    { role: 'assistant' as const, content: '上次的回答' },
  ])
  service.clearMessages = vi.fn(async () => { throw new Error('网络中断') })
  render(<KnowledgePage api={service} />)
  expect(await screen.findByText('上次的问题')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '清空会话' }))
  expect((await screen.findByRole('alert')).textContent ?? '').toContain('清空失败')
  expect(await screen.findByText('上次的问题')).toBeTruthy()
  expect(screen.getByText('上次的回答')).toBeTruthy()
})

it('asks the selected knowledge base through chat completions and renders recommendations', async () => {
  const service = api()
  service.complete = vi.fn(async (_id, _question, onProgress) => {
    onProgress?.({ answer: '知', done: false })
    onProgress?.({ answer: '知识库回答', recommendations: ['继续提问'], done: true })
    return { answer: '知识库回答', recommendations: ['继续提问'] }
  })
  const { container } = render(<KnowledgePage api={service} />)
  const pane = container.querySelector('.dsh-knowledge-messages') as HTMLDivElement
  Object.defineProperty(pane, 'scrollHeight', { configurable: true, get: () => 960 })
  const input = await screen.findByPlaceholderText('基于知识库提问')
  fireEvent.change(input, { target: { value: '请概括文档' } })
  expect(screen.getByRole('button', { name: '发送' }).className).toContain('ready')
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => expect(service.complete).toHaveBeenCalled())
  expect(service.complete).toHaveBeenCalledWith(
    1, '请概括文档', expect.any(Function), expect.any(AbortSignal), undefined,
  )
  expect(await screen.findByText('知识库回答')).toBeTruthy()
  expect(screen.getByText('万维')).toBeTruthy()
  expect(screen.getByText('继续提问')).toBeTruthy()
  expect(screen.getByRole('button', { name: '发送' }).className).toContain('idle')
  await waitFor(() => expect(pane.scrollTop).toBe(960))
})

it('shows typing dots and a stop control while waiting for the first answer chunk', async () => {
  let finish!: (value: { answer: string; recommendations: string[] }) => void
  const service = api()
  service.complete = vi.fn((_id, _question, onProgress, signal) =>
    new Promise<{ answer: string; recommendations: string[] }>((resolve, reject) => {
      finish = resolve
      signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      }, { once: true })
      onProgress?.({ answer: '', done: false })
    }))
  render(<KnowledgePage api={service} />)
  const input = await screen.findByPlaceholderText('基于知识库提问')
  fireEvent.change(input, { target: { value: '请概括文档' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  expect(await screen.findByRole('status', { name: '正在回答…' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '停止' })).toBeTruthy()
  expect(screen.getByText('万维')).toBeTruthy()
  finish({ answer: '知识库回答', recommendations: [] })
  expect(await screen.findByText('知识库回答')).toBeTruthy()
  expect(screen.getByRole('button', { name: '发送' }).className).toContain('idle')
})

it('opens a PDF preview with pdf.js when a content list item is clicked', async () => {
  const service = api()
  stubCanvas()
  const createObjectURL = vi.fn(() => 'blob:doc')
  const revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
  const click = vi.fn()
  const createElement = window.document.createElement.bind(window.document)
  vi.spyOn(window.document, 'createElement').mockImplementation((tagName: string) => {
    const element = createElement(tagName)
    if (tagName === 'a') Object.defineProperty(element, 'click', { value: click })
    return element
  })
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /说明\.pdf/ }))
  await waitFor(() => expect(service.download).toHaveBeenCalledWith(1, 'doc-1'))
  expect(service.chunks).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog', { name: '说明.pdf' })).toBeTruthy()
  expect(await screen.findByAltText('PDF 1')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '下载' }))
  await waitFor(() => expect(click).toHaveBeenCalled())
  // Preview already cached the original bytes; save should not download again.
  expect(service.download).toHaveBeenCalledTimes(1)
  expect(createObjectURL).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '关闭' }))
  expect(screen.queryByRole('dialog', { name: '说明.pdf' })).toBeNull()
})

it('opens 问问万维 beside a preview and asks the current knowledge base about that file', async () => {
  const service = api()
  stubCanvas()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:doc') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  service.complete = vi.fn(async (_id, _question, onProgress) => {
    const answer = { answer: '这是文件摘要', recommendations: [] as string[] }
    onProgress?.({ ...answer, done: true })
    return answer
  })
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /说明\.pdf/ }))
  const dialog = await screen.findByRole('dialog', { name: '说明.pdf' })
  fireEvent.click(within(dialog).getByRole('button', { name: '问问万维' }))
  const ask = within(dialog).getByRole('complementary', { name: '问问万维' })
  expect(within(ask).getByText('你好，我是你的智能助手万维，能帮你速读文章、答疑解惑，快向我提问吧！')).toBeTruthy()
  expect(within(ask).queryByText('DS 快速')).toBeNull()
  fireEvent.click(within(ask).getByRole('button', { name: '总结' }))
  await waitFor(() => expect(service.complete).toHaveBeenCalledWith(
    1, '请总结文档的主要内容、关键步骤与要点（文件：说明.pdf）。',
    expect.any(Function), expect.any(AbortSignal), 'doc-1',
  ))
  expect(await within(ask).findByText('这是文件摘要')).toBeTruthy()
  fireEvent.click(within(ask).getByRole('button', { name: '关闭问问万维' }))
  expect(within(dialog).queryByRole('complementary', { name: '问问万维' })).toBeNull()
  expect(within(dialog).getByRole('button', { name: '问问万维' })).toBeTruthy()
})

it('locates a preview answer citation in the open preview without loading it again', async () => {
  const service = api()
  stubCanvas()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:doc') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  service.complete = vi.fn(async (_id, _question, onProgress) => {
    const answer = {
      answer: '依据制度执行。##0$$',
      recommendations: [] as string[],
      citations: [{
        index: 1, chunk_index: 0, document_id: 'doc-1', document_name: '说明.pdf',
        quote: '适用范围', page: 1,
        positions: [{ page: 1, left: 0.1, right: 0.5, top: 0.2, bottom: 0.3 }],
      }],
    }
    onProgress?.({ ...answer, done: true })
    return answer
  })
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /说明\.pdf/ }))
  const dialog = await screen.findByRole('dialog', { name: '说明.pdf' })
  await screen.findByAltText('PDF 1')
  fireEvent.click(within(dialog).getByRole('button', { name: '问问万维' }))
  fireEvent.click(within(dialog).getByRole('button', { name: '总结' }))
  fireEvent.click(await within(dialog).findByRole('button', { name: '引用定位 【1】' }))
  expect(service.download).toHaveBeenCalledTimes(1)
  expect(within(dialog).getByRole('complementary', { name: '问问万维' })).toBeTruthy()
  await waitFor(() => expect(dialog.querySelector('.dsh-knowledge-pdf-hit')).toBeTruthy())
})

it('opens a cited PDF when a blue answer citation number is clicked', async () => {
  const service = api()
  stubCanvas()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:doc') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  service.complete = vi.fn(async (_id, _question, onProgress) => {
    const answer = {
      answer: '依据制度执行。##0$$',
      recommendations: [] as string[],
      citations: [{
        index: 1, chunk_index: 0, document_id: 'doc-1', document_name: '说明.pdf',
        quote: '适用范围', page: 1,
        positions: [{ page: 1, left: 0.1, right: 0.5, top: 0.2, bottom: 0.3 }],
      }],
    }
    onProgress?.({ ...answer, done: true })
    return answer
  })
  render(<KnowledgePage api={service} />)
  const input = await screen.findByPlaceholderText('基于知识库提问')
  fireEvent.change(input, { target: { value: '制度要求是什么' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  expect(await screen.findByRole('button', { name: '引用定位 【1】' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '引用定位 【1】' }))
  await waitFor(() => expect(service.download).toHaveBeenCalledWith(1, 'doc-1'))
  expect(screen.getByRole('dialog', { name: '说明.pdf' })).toBeTruthy()
})

it('turns answer [ID:i] markers into inline locate controls without trailing source chips', async () => {
  const service = api()
  stubCanvas()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:doc') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  service.complete = vi.fn(async (_id, _question, onProgress) => {
    const answer = {
      answer: '准备工作包括：[ID:0]',
      recommendations: [] as string[],
      citations: [
        {
          index: 1, chunk_index: 0, document_id: 'doc-1', document_name: '说明.pdf',
          quote: '建表', page: 1,
          positions: [{ page: 1, left: 0.1, right: 0.5, top: 0.2, bottom: 0.3 }],
        },
        { index: 2, chunk_index: 1, document_id: 'doc-2', document_name: '其它.pdf', quote: '其它' },
      ],
    }
    onProgress?.({ ...answer, done: true })
    return answer
  })
  render(<KnowledgePage api={service} />)
  const input = await screen.findByPlaceholderText('基于知识库提问')
  fireEvent.change(input, { target: { value: '准备工作是什么' } })
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  expect(await screen.findByRole('button', { name: '引用定位 【1】' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: '引用定位 【2】' })).toBeNull()
  expect(screen.queryByText(/\[ID:0\]/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '引用定位 【1】' }))
  await waitFor(() => expect(service.download).toHaveBeenCalledWith(1, 'doc-1'))
})

it('previews images through the original file blob', async () => {
  const service = api()
  service.documents = vi.fn(async () => [{ id: 'img-1', name: '截图.png', size: 128, run: 'DONE', progress: 1 }])
  service.download = vi.fn(async () => ({ contentType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) }))
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:image') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  render(<KnowledgePage api={service} />)
  fireEvent.click(await screen.findByRole('button', { name: /截图\.png/ }))
  await waitFor(() => expect(service.download).toHaveBeenCalledWith(1, 'img-1'))
  expect(screen.getByRole('img', { name: '截图.png' })).toBeTruthy()
})

it('selects a document on right-click and shows move, copy, and delete actions', async () => {
  const service = api()
  render(<KnowledgePage api={service} />)
  const row = await screen.findByRole('button', { name: /说明\.pdf/ })
  fireEvent.contextMenu(row)
  expect(row.className).toContain('selected')
  expect(screen.getByRole('menuitem', { name: '移动到' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '复制到' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '删除' })).toBeTruthy()
  expect(screen.queryByRole('menuitem', { name: '重命名' })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: '编辑标签' })).toBeNull()
})

it('moves a selected document into another personal or shared library', async () => {
  const service = api()
  service.documents = vi.fn(async (id: number) => id === 1
    ? [{ id: 'doc-1', name: '说明.pdf', size: 2048, run: 'DONE', progress: 1 }]
    : [])
  render(<KnowledgePage api={service} />)
  fireEvent.contextMenu(await screen.findByRole('button', { name: /说明\.pdf/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: '移动到' }))
  const dialog = await screen.findByRole('dialog', { name: /移动/ })
  fireEvent.click(dialog.querySelector('aside button') as HTMLButtonElement)
  fireEvent.click(screen.getByRole('button', { name: '移动至此' }))
  await waitFor(() => expect(service.move).toHaveBeenCalledWith(1, 'doc-1', 3, undefined))
})

it('asks for confirmation before deleting a selected document', async () => {
  const service = api()
  render(<KnowledgePage api={service} />)
  fireEvent.contextMenu(await screen.findByRole('button', { name: /说明\.pdf/ }))
  fireEvent.click(screen.getByRole('menuitem', { name: '删除' }))
  const dialog = await screen.findByRole('dialog', { name: '确认删除' })
  expect(dialog.textContent).toContain('说明.pdf')
  expect(service.delete).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
  await waitFor(() => expect(service.delete).toHaveBeenCalledWith(1, 'doc-1'))
})
